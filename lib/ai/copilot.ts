import { forecastNext24h, Forecast24h } from "@/lib/forecasting";
import {
  getOptimizationComparison,
  getOptimizationDecisions,
  OptimizationComparison,
  OptimizationDecision,
} from "@/lib/optimization";
import {
  Alert,
  Asset,
  DashboardData,
  getActiveAlerts,
  getDashboardData,
  getLiveAssets,
  getNowHour,
} from "@/lib/simulation";
import { formatHourLabel, formatKg, formatKw, formatKwh, formatRm, formatRmPerYear } from "@/lib/utils/format";
import { answerWithClaude, COPILOT_MODEL, CopilotChatMessage, isClaudeConfigured } from "./claudeProvider";
import { isInScope, looksLikeInjection, SCOPE_REDIRECT_MESSAGE } from "./guard";
import { checkClaudeAllowance } from "./rateLimit";
import { getRecommendations, Recommendation } from "./recommendations";

/** Everything the copilot can ground an answer in — one snapshot per question. */
interface CopilotContext {
  nowHour: number;
  data: DashboardData;
  assets: Asset[];
  alerts: Alert[];
  forecast: Forecast24h;
  recommendations: Recommendation[];
  comparison: OptimizationComparison;
  decisions: OptimizationDecision[];
}

function buildContext(): CopilotContext {
  return {
    nowHour: getNowHour(),
    data: getDashboardData(),
    assets: getLiveAssets(),
    alerts: getActiveAlerts(),
    forecast: forecastNext24h(),
    recommendations: getRecommendations(),
    comparison: getOptimizationComparison(),
    decisions: getOptimizationDecisions(),
  };
}

/**
 * Intent router: each entry pairs keyword triggers with an answer builder that reads
 * real numbers out of the context. First match wins; order matters (more specific
 * intents first). This is the "smart rule-based copilot" — an LLM provider can replace
 * answerQuestion() wholesale (see provider seam below) without touching the UI or API route.
 */
const INTENTS: { match: RegExp; answer: (ctx: CopilotContext, question: string) => string }[] = [
  // --- Optimization intents (Phase 3) — most specific first ---
  {
    match: /(what|which).*(vpp|system|ai).*(optimi|coordinat|decide|did.*today)|optimi[sz]e.*today/i,
    answer: (ctx) => {
      const c = ctx.comparison;
      const byWindow = ctx.decisions
        .slice(0, 6)
        .map((d) => `${d.windowLabel}: ${d.title.toLowerCase()}`)
        .join("; ");
      return (
        `Today the VPP executed ${ctx.decisions.length} coordinated actions: ${byWindow}. ` +
        `Net result vs uncoordinated operation: peak demand down ${c.peakDemandReductionPct.toFixed(0)}% (${formatKw(c.peakDemandReductionKw)}), grid imports down ${formatKwh(c.gridImportReductionKwh)}, ` +
        `renewable utilization up from ${c.renewablePctBefore.toFixed(0)}% to ${c.renewablePctAfter.toFixed(0)}%, saving ${formatRm(c.costSavedUsd)} and ${formatKg(c.carbonSavedKg)} of CO₂.`
      );
    },
  },
  {
    match: /why.*batter.*(discharg|drain|6\s?pm|evening|peak)|batter.*why.*discharg/i,
    answer: (ctx) => {
      const d = ctx.decisions.find((dec) => dec.type === "battery_discharge");
      if (!d) return "The battery hasn't run a discharge cycle today — renewables covered the peak without storage support.";
      return (
        `The battery discharged during ${d.windowLabel} as a deliberate peak-shaving move. ${d.reason} ` +
        `Averaging ${formatKw(d.avgKw)} of discharge, it cut peak grid import by ${formatKw(ctx.comparison.peakImportReductionKw)} (${ctx.comparison.peakImportReductionPct.toFixed(0)}%) versus the uncoordinated baseline.`
      );
    },
  },
  {
    match: /(how much|what).*(peak).*(reduc|shav|cut|lower)|peak.*(reduc|shav).*(how|much)/i,
    answer: (ctx) => {
      const c = ctx.comparison;
      return (
        `Peak demand was cut from ${formatKw(c.before.peakDemandKw)} to ${formatKw(c.after.peakDemandKw)} — down ${c.peakDemandReductionPct.toFixed(0)}% (${formatKw(c.peakDemandReductionKw)}). ` +
        `Peak grid import fell even more: from ${formatKw(c.before.peakGridImportKw)} to ${formatKw(c.after.peakGridImportKw)} (-${c.peakImportReductionPct.toFixed(0)}%), thanks to battery discharge and shifting ${formatKwh(c.evShiftedKwh)} of EV charging out of the 4-9pm window.`
      );
    },
  },
  {
    match: /why.*(ev|charging).*(delay|defer|shift|postpon)|ev.*(delay|shift).*why/i,
    answer: (ctx) => {
      const d = ctx.decisions.find((dec) => dec.type === "ev_delay");
      const resume = ctx.decisions.find((dec) => dec.type === "ev_resume");
      if (!d) return "No EV charging was delayed today — evening load stayed within safe limits.";
      return (
        `EV charging was delayed during ${d.windowLabel} (about ${formatKw(d.avgKw)} of flexible load). ${d.reason} ` +
        (resume
          ? `The deferred sessions ran at ${resume.windowLabel} on off-peak power instead. `
          : "") +
        `In total ${formatKwh(ctx.comparison.evShiftedKwh)} moved to cheaper, cleaner hours — drivers still get charged, the grid never sees the spike.`
      );
    },
  },
  {
    match: /(biggest|largest|top|main).*(sav|win|impact|improvement)/i,
    answer: (ctx) => {
      const c = ctx.comparison;
      const evSavings = ctx.comparison.evShiftedKwh * (0.34 - 0.11);
      return (
        `The single biggest lever today is battery peak-shaving: it cut peak grid import by ${formatKw(c.peakImportReductionKw)} during the RM0.34/kWh window, which drives most of the ${formatRm(c.costSavedUsd)} total saving. ` +
        `Second is EV load shifting — ${formatKwh(c.evShiftedKwh)} moved off-peak, worth roughly ${formatRm(evSavings)}. ` +
        `The same actions avoided ${formatKg(c.carbonSavedKg)} of CO₂ by lifting renewable utilization from ${c.renewablePctBefore.toFixed(0)}% to ${c.renewablePctAfter.toFixed(0)}%.`
      );
    },
  },
  // --- Situational awareness intents (Phase 2) ---
  {
    match: /(why|what).*(demand|load).*(high|peak|rising|up)|demand.*(why|high)/i,
    answer: (ctx) => {
      const { current } = ctx.data;
      const peak = ctx.forecast.insights.peakDemand;
      const evShare = Math.round((current.evDemandKw / Math.max(1, current.totalDemandKw)) * 100);
      return (
        `Total demand is currently ${formatKw(current.totalDemandKw)} — buildings account for ${formatKw(current.buildingDemandKw)} and EV charging adds ${formatKw(current.evDemandKw)} (${evShare}% of the total). ` +
        `Demand climbs through the late afternoon as building HVAC load overlaps with commuter EV charging, and is forecast to peak at ${formatKw(peak.kw)} around ${formatHourLabel(peak.hourOfDay)}. ` +
        `Electricity is priced at RM${current.electricityPrice.toFixed(2)}/kWh right now, so the optimizer is working to keep grid imports low through this window.`
      );
    },
  },
  {
    match: /(what|how).*(before|prepare|ready|do).*(peak|6\s?pm|evening)|before.*peak/i,
    answer: (ctx) => {
      const { current } = ctx.data;
      const peak = ctx.forecast.insights.peakDemand;
      const top = ctx.recommendations.slice(0, 3);
      const steps = top.map((r, i) => `${i + 1}. ${r.action} (${Math.round(r.confidence * 100)}% confidence)`).join(" ");
      return (
        `Demand peaks at ${formatKw(peak.kw)} around ${formatHourLabel(peak.hourOfDay)}. The battery is at ${Math.round(current.batterySocPercent)}% state of charge. My playbook before the peak: ${steps} ` +
        `Executed together, these keep on-peak grid imports to a minimum while power costs RM0.34/kWh.`
      );
    },
  },
  {
    match: /(which|what).*(asset|farm|turbine|plant).*(underperform|worst|weak|low|problem)|underperforming/i,
    answer: (ctx) => {
      const ranked = ctx.assets
        .filter((a) => a.type !== "battery_storage" && a.type !== "ev_charging_station" && a.type !== "smart_building")
        .map((a) => ({ a, ratio: a.currentOutputKw / a.capacityKw }))
        .sort((x, y) => x.ratio - y.ratio);
      const worst = ranked[0];
      const alertNote = ctx.alerts.find((al) => al.assetId === worst.a.id);
      return (
        `${worst.a.name} is the weakest performer right now, producing ${formatKw(worst.a.currentOutputKw)} of its ${formatKw(worst.a.capacityKw)} capacity (${Math.round(worst.ratio * 100)}% utilization, health score ${worst.a.healthScore}/100). ` +
        (alertNote
          ? `There is an active alert on it: ${alertNote.cause} Recommended action: ${alertNote.recommendedAction}`
          : `No active alerts on it — current output is consistent with ${ctx.data.current.weather.replace("_", " ")} conditions and the time of day.`)
      );
    },
  },
  {
    // Asset health / utilization questions — "utilization shows 0%?", "health score 89 — what happened?"
    match: /(health\s*score|utili[sz]ation|capacity\s*fade|degrad)/i,
    answer: (ctx, question) => {
      const q = question.toLowerCase();
      const TYPE_KEYWORDS: [RegExp, Asset["type"]][] = [
        [/battery|storage/, "battery_storage"],
        [/solar/, "solar_farm"],
        [/wind|turbine/, "wind_turbine"],
        [/hydro/, "hydro_plant"],
        [/\bev\b|charg/, "ev_charging_station"],
        [/building/, "smart_building"],
      ];
      const matchedType = TYPE_KEYWORDS.find(([re]) => re.test(q))?.[1];
      const asset =
        ctx.assets.find((a) => q.includes(a.name.toLowerCase())) ??
        (matchedType ? ctx.assets.find((a) => a.type === matchedType) : undefined);

      if (!asset) {
        const worst = [...ctx.assets].sort((a, b) => a.healthScore - b.healthScore)[0];
        const avg = Math.round(ctx.assets.reduce((s, a) => s + a.healthScore, 0) / ctx.assets.length);
        return (
          `Fleet health averages ${avg}/100 across ${ctx.assets.length} assets; the lowest is ${worst.name} at ${worst.healthScore}/100. ` +
          `Utilization measures how much of an asset's capacity is flowing right now; health score tracks its long-term condition from monitoring. Ask about a specific asset for details.`
        );
      }

      const alert = ctx.alerts.find((al) => al.assetId === asset.id);
      const util = Math.round((asset.currentOutputKw / asset.capacityKw) * 100);

      if (asset.type === "battery_storage") {
        const soc = Math.round(ctx.data.current.batterySocPercent);
        const flow = ctx.data.current.batteryFlowKw;
        const state =
          flow > 10
            ? `charging at ${formatKw(flow)}`
            : flow < -10
              ? `discharging at ${formatKw(Math.abs(flow))}`
              : "idle — holding its stored energy rather than charging or discharging";
        return (
          `Those are two different measurements, and both are correct. Utilization is the power flowing through the battery right now: it reads ${util}% because the battery is ${state}. ` +
          `State of charge — how full it is — sits at ${soc}%. Health score (${asset.healthScore}/100) tracks long-term condition, not today's activity. ` +
          (alert
            ? `The score reflects an active alert: ${alert.cause} Recommended action: ${alert.recommendedAction}`
            : `No active alerts on it.`)
        );
      }

      return (
        `${asset.name} is running at ${util}% utilization (${formatKw(asset.currentOutputKw)} of ${formatKw(asset.capacityKw)} capacity) with a health score of ${asset.healthScore}/100. ` +
        `Utilization reflects this moment — weather and time of day — while health score tracks the asset's long-term condition. ` +
        (alert ? `Active alert: ${alert.cause} Recommended action: ${alert.recommendedAction}` : `No active alerts on it.`)
      );
    },
  },
  {
    match: /(how much|what).*(renewable|clean|green).*(us|share|percent|using)|renewable.*(percent|share|much)/i,
    answer: (ctx) => {
      const { aiTotals, rawTotals, current } = ctx.data;
      return (
        `Right now the fleet is generating ${formatKw(current.totalGenerationKw)} of renewable power against ${formatKw(current.totalDemandKw)} of demand. ` +
        `Across today, ${Math.round(aiTotals.renewablePct)}% of energy consumed is renewable under AI dispatch — versus ${Math.round(rawTotals.renewablePct)}% without it. ` +
        `Total renewable production today is on track for ${formatKwh(aiTotals.totalGenerationKwh)}, and the 24h forecast shows a net ${ctx.forecast.insights.netSurplusKwh >= 0 ? "surplus" : "shortage"} of ${formatKwh(Math.abs(ctx.forecast.insights.netSurplusKwh))}.`
      );
    },
  },
  {
    match: /(biggest|main|top|what).*(risk|threat|concern|worry)|risk.*today/i,
    answer: (ctx) => {
      const { gridRisk, worstShortage, peakDemand } = ctx.forecast.insights;
      const worstAlert = ctx.alerts[0];
      return (
        `The biggest risk today is grid import exposure during the evening peak — I rate it ${gridRisk.level.toUpperCase()}. ${gridRisk.reason} ` +
        (worstShortage
          ? `The tightest moment lands around ${formatHourLabel(worstShortage.hourOfDay)}, when demand outruns renewables by ~${formatKw(worstShortage.kw)}. `
          : "") +
        `Peak demand of ${formatKw(peakDemand.kw)} is expected near ${formatHourLabel(peakDemand.hourOfDay)}.` +
        (worstAlert ? ` On the asset side: ${worstAlert.cause}` : "")
      );
    },
  },
  {
    match: /(cost|money|sav|dollar|\$)/i,
    answer: (ctx) => {
      const { costSavedUsd, peakDemandReductionKw, aiTotals, rawTotals } = ctx.data;
      const netLabel = (v: number) => (v < 0 ? `a ${formatRm(-v)} net credit` : `a ${formatRm(v)} net cost`);
      return (
        `AI dispatch has saved ${formatRm(costSavedUsd)} today versus running the same fleet without optimization (${netLabel(rawTotals.totalCostUsd)} unoptimized vs ${netLabel(aiTotals.totalCostUsd)} optimized, net of export credits). ` +
        `The savings come from charging the battery on midday solar surplus instead of buying RM0.34/kWh on-peak power, plus cutting peak grid import by ${formatKw(peakDemandReductionKw)}. ` +
        `At today's rate that is an annualized run-rate of roughly ${formatRmPerYear(costSavedUsd)} for this single site.`
      );
    },
  },
  {
    match: /(carbon|co2|emission|climate)/i,
    answer: (ctx) => {
      const { carbonSavedKg, aiTotals, rawTotals } = ctx.data;
      return (
        `The VPP has avoided ${formatKg(carbonSavedKg)} of CO₂ today by displacing grid imports with stored renewable energy (${formatKg(rawTotals.totalCarbonKg)} unoptimized vs ${formatKg(aiTotals.totalCarbonKg)} with AI dispatch, at 0.4 kg CO₂/kWh grid intensity). ` +
        `Renewable coverage of demand is up ${Math.round(ctx.data.renewablePctImprovement)} percentage points thanks to load shifting and battery timing.`
      );
    },
  },
  {
    match: /(battery|soc|storage|charge level)/i,
    answer: (ctx) => {
      const { current } = ctx.data;
      const flow =
        current.batteryFlowKw > 10
          ? `charging at ${formatKw(current.batteryFlowKw)}`
          : current.batteryFlowKw < -10
            ? `discharging at ${formatKw(Math.abs(current.batteryFlowKw))}`
            : "idle";
      const rec = ctx.recommendations.find((r) => r.id === "rec-discharge-peak" || r.id === "rec-charge-midday");
      const battery = ctx.assets.find((a) => a.type === "battery_storage");
      const alert = battery && ctx.alerts.find((al) => al.assetId === battery.id);
      return (
        `The ${battery?.name ?? "battery array"} is at ${Math.round(current.batterySocPercent)}% state of charge and currently ${flow}. ` +
        (rec ? `Next move: ${rec.action}` : "No battery action is scheduled — SOC is where the optimizer wants it.") +
        (alert ? ` Note: ${alert.cause}` : "")
      );
    },
  },
  {
    match: /(weather|cloud|rain|sun|wind speed)/i,
    answer: (ctx) =>
      `${ctx.forecast.insights.weatherImpact} Current conditions: ${ctx.data.current.weather.replace("_", " ")}.`,
  },
  {
    match: /(forecast|predict|tomorrow|next 24|outlook)/i,
    answer: (ctx) => {
      const { peakDemand, peakGeneration, netSurplusKwh, gridRisk } = ctx.forecast.insights;
      return (
        `Over the next 24 hours: generation peaks at ${formatKw(peakGeneration.kw)} around ${formatHourLabel(peakGeneration.hourOfDay)}, demand peaks at ${formatKw(peakDemand.kw)} around ${formatHourLabel(peakDemand.hourOfDay)}, ` +
        `and the fleet runs a net renewable ${netSurplusKwh >= 0 ? "surplus" : "shortage"} of ${formatKwh(Math.abs(netSurplusKwh))}. Grid import risk is ${gridRisk.level}. ${ctx.forecast.insights.weatherImpact}`
      );
    },
  },
  {
    match: /(alert|warning|problem|issue|wrong)/i,
    answer: (ctx) => {
      if (ctx.alerts.length === 0) return "No active alerts — every asset in the fleet is operating within normal parameters.";
      const lines = ctx.alerts.map((a) => `${a.assetName} (${a.severity}): ${a.cause} → ${a.recommendedAction}`);
      return `There ${ctx.alerts.length === 1 ? "is 1 active alert" : `are ${ctx.alerts.length} active alerts`}: ${lines.join(" ")}`;
    },
  },
];

function fallbackAnswer(ctx: CopilotContext): string {
  const { current } = ctx.data;
  const top = ctx.recommendations[0];
  return (
    `Here's the current picture: renewable generation is ${formatKw(current.totalGenerationKw)} against ${formatKw(current.totalDemandKw)} of demand, the battery sits at ${Math.round(current.batterySocPercent)}%, and grid import risk over the next 24h is ${ctx.forecast.insights.gridRisk.level}. ` +
    (top ? `Top recommendation right now: ${top.title.toLowerCase()} — ${top.action} ` : "") +
    `You can ask me things like "Why is demand high today?", "What should we do before the 6pm peak?", "Which asset is underperforming?", or "What is the biggest risk today?"`
  );
}

/** Deterministic engine: intent-route the question against the live context. */
function answerWithRules(question: string, ctx: CopilotContext): string {
  for (const intent of INTENTS) {
    if (intent.match.test(question)) return intent.answer(ctx, question);
  }
  return fallbackAnswer(ctx);
}

export type CopilotMode = "claude" | "rules";

export interface CopilotAnswer {
  reply: string;
  /** Which engine produced the reply — surfaced in the UI as AI-powered vs fallback. */
  mode: CopilotMode;
}

/** Per-request context the route supplies for the public-demo protection layer. */
export interface AnswerOptions {
  /** Visitor identifier (resolved IP) used only as a rate-limit key. */
  ip?: string;
  /** Set by the input guard when the latest question is oversized/unreasonable. */
  forceRules?: boolean;
}

/** Concise, dev-only diagnostics. Never logs keys, tokens, or prompt/message text. */
function log(msg: string): void {
  if (process.env.NODE_ENV !== "production") console.log(`[copilot] ${msg}`);
}

// --- TEMPORARY production diagnostic (gate decision only) --------------------
// Emits exactly one safe reason token per request (production-visible, unlike
// log()) so Vercel logs reveal why Claude was skipped or attempted. Logs no API
// key, Redis token, env values, prompts, or user message text — only the fixed
// reason token below. REMOVE once the Production Claude path is confirmed.
function diag(reason: string): void {
  console.log(`[copilot-diag] ${reason}`);
}
/** Maps internal gate reasons to the safe diagnostic tokens. */
const GATE_DIAG: Record<string, string> = {
  short_window: "short_window_limit",
  daily_ip: "daily_ip_limit",
  global_ceiling: "global_ceiling",
  redis_unavailable: "redis_unavailable",
  redis_unconfigured: "redis_unconfigured",
};

/**
 * Provider seam + public-demo protection gate. When ANTHROPIC_API_KEY is
 * configured, in-scope non-abusive questions from a visitor still within their
 * rate limits go to Claude, grounded in the same live context the dashboard
 * renders. Every other path — missing/invalid key, error, timeout, oversized
 * input, out-of-scope question, obvious injection, per-IP or global limit
 * reached, or limiter failure in production — degrades to the deterministic rule
 * engine. The { reply, mode } contract and provider badge are unchanged: any
 * protected path simply returns mode "rules".
 */
export async function answerQuestion(
  question: string,
  history?: CopilotChatMessage[],
  options?: AnswerOptions
): Promise<CopilotAnswer> {
  const ctx = buildContext();

  // 0. No key, or the input guard already flagged the question as oversized.
  if (!isClaudeConfigured()) {
    diag("missing_anthropic_key");
    log("ANTHROPIC_API_KEY not set; fallback activated (rule engine)");
    return { reply: answerWithRules(question, ctx), mode: "rules" };
  }
  if (options?.forceRules) {
    log("input rejected (oversized/unreasonable); fallback activated (rule engine)");
    return { reply: answerWithRules(question, ctx), mode: "rules" };
  }

  // 1. Scope gate — keep off-topic questions off the paid Claude path. Reuses
  //    the existing intent patterns as an additional in-domain signal.
  const inScope = isInScope(question) || INTENTS.some((i) => i.match.test(question));
  if (!inScope) {
    diag("scope_rejected");
    log("scope rejected; returning WeaveGrid redirect (rule engine)");
    return { reply: SCOPE_REDIRECT_MESSAGE, mode: "rules" };
  }

  // 2. Obvious prompt-injection / exfiltration attempts never reach Claude.
  if (looksLikeInjection(question)) {
    diag("injection_rejected");
    log("injection-style input rejected; returning safe redirect (rule engine)");
    return { reply: SCOPE_REDIRECT_MESSAGE, mode: "rules" };
  }

  // 3. Rate limits + global ceiling — consulted only now, so this represents a
  //    genuine opportunity to spend Anthropic credit. Any block => rule engine.
  const gate = await checkClaudeAllowance(options?.ip ?? "local-dev");
  if (!gate.allow) {
    diag(GATE_DIAG[gate.reason ?? ""] ?? "gate_rejected");
    log(`Claude skipped (${gate.reason}); fallback activated (rule engine)`);
    return { reply: answerWithRules(question, ctx), mode: "rules" };
  }

  // 4. Call Claude; any failure/timeout degrades to the rule engine.
  try {
    diag("claude_attempted");
    log(`Claude request attempted (model=${COPILOT_MODEL})`);
    const reply = await answerWithClaude(
      history?.length ? history : [{ role: "user", content: question }],
      JSON.stringify(ctx)
    );
    log(`Claude request succeeded (model=${COPILOT_MODEL})`);
    return { reply, mode: "claude" };
  } catch (err) {
    console.error("[copilot] Claude call failed; fallback activated (rule engine):", err);
    return { reply: answerWithRules(question, ctx), mode: "rules" };
  }
}
