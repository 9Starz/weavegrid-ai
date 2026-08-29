import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { SectionCard } from "@/components/shared/SectionCard";
import { BeforeAfterImportChart } from "@/components/optimization/BeforeAfterImportChart";
import { getOptimizationComparison, getOptimizationDecisions } from "@/lib/optimization";
import { getTodaySeries } from "@/lib/simulation";
import { formatHourLabel, formatKg, formatKw, formatKwh, formatRm, formatRmPerYear } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  const comparison = getOptimizationComparison();
  const decisions = getOptimizationDecisions();
  const { raw, aiOptimized } = getTodaySeries();

  const charge = decisions.find((d) => d.type === "battery_charge" && d.startHour >= 6);
  const discharge = decisions.find((d) => d.type === "battery_discharge");
  const evDelay = decisions.find((d) => d.type === "ev_delay");

  // The "before" story: when does the uncoordinated fleet hurt the most?
  const rawTotals = comparison.before;
  const peakLabel = formatHourLabel(rawTotals.peakGridImportHour);

  const aiMoves = [
    charge && {
      step: "1",
      window: charge.windowLabel,
      title: "Bank free midday renewables",
      detail: charge.reason,
    },
    evDelay && {
      step: "2",
      window: evDelay.windowLabel,
      title: "Move flexible EV load out of the peak",
      detail: evDelay.reason,
    },
    discharge && {
      step: "3",
      window: discharge.windowLabel,
      title: "Discharge the battery through the peak",
      detail: discharge.reason,
    },
  ].filter(Boolean) as { step: string; window: string; title: string; detail: string }[];

  const results = [
    { label: "Peak Demand", value: `-${comparison.peakDemandReductionPct.toFixed(0)}%`, hint: `${formatKw(comparison.peakDemandReductionKw)} shaved` },
    { label: "Grid Energy Imported", value: `-${comparison.gridImportReductionPct.toFixed(0)}%`, hint: `${formatKwh(comparison.gridImportReductionKwh)} avoided` },
    { label: "Cost Saved", value: formatRm(comparison.costSavedUsd), hint: `≈ ${formatRmPerYear(comparison.costSavedUsd)} annualized run-rate` },
    { label: "CO₂ Avoided", value: formatKg(comparison.carbonSavedKg), hint: `renewables ${comparison.renewablePctBefore.toFixed(0)}% → ${comparison.renewablePctAfter.toFixed(0)}%` },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Demo Story" subtitle="The 6pm peak — one day, same assets, with and without AI coordination" />

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {/* Act 1 — the problem */}
        <SectionCard
          title="Act 1 · The 6pm problem"
          subtitle="Every evening, buildings and EV chargers peak together — exactly when electricity is most expensive"
        >
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            As offices wind down and commuters plug in, demand across the fleet climbs to{" "}
            <span className="font-medium text-foreground">{formatKw(rawTotals.peakDemandKw)}</span> — right as solar
            output collapses and on-peak power hits{" "}
            <span className="font-medium text-warning">RM0.34/kWh, three times the overnight rate</span>. Left
            uncoordinated, the site imports up to{" "}
            <span className="font-medium text-critical">{formatKw(rawTotals.peakGridImportKw)}</span> of expensive,
            carbon-heavy grid power around {peakLabel}. Every asset behaves sensibly on its own; the system as a whole
            still fails.
          </p>
        </SectionCard>

        {/* Act 2 — what the AI does */}
        <SectionCard
          title="Act 2 · Three coordinated moves"
          subtitle="The VPP decision engine plans the whole day around that peak"
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {aiMoves.map((m) => (
              <div key={m.step} className="rounded-xl border border-border bg-surface-raised/40 p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-green-dim/15 text-sm font-semibold text-accent-green">
                    {m.step}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-muted">{m.window}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">{m.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{m.detail}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Act 3 — the measurable result */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SectionCard
            title="Act 3 · The result"
            subtitle="Grid import, same day: dashed red = uncoordinated, green = AI-coordinated"
            className="xl:col-span-2"
          >
            <BeforeAfterImportChart rawPoints={raw.points} aiPoints={aiOptimized.points} />
          </SectionCard>

          <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">
            {results.map((r) => (
              <div key={r.label} className="rounded-xl border border-accent-green-dim/30 bg-gradient-to-br from-accent-green-dim/10 via-surface to-surface p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{r.label}</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-accent-green">{r.value}</p>
                <p className="mt-0.5 text-xs text-muted">{r.hint}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recap + where to dig deeper */}
        <SectionCard title="The 60-second takeaway" subtitle="What just happened, in one sentence">
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            <span className="font-medium text-foreground">
              WeaveGrid AI turned {decisions.length} coordinated decisions into {formatRm(comparison.costSavedUsd)} of
              savings — an annualized run-rate of ≈{formatRmPerYear(comparison.costSavedUsd).replace("/yr", " a year")}{" "}
              from this single site — plus {formatKg(comparison.carbonSavedKg)} of avoided CO₂ and a{" "}
              {comparison.peakDemandReductionPct.toFixed(0)}% lower peak
            </span>{" "}
            — using the exact same assets, weather, and demand. Explore the{" "}
            <Link href="/optimization" className="text-accent-green hover:underline">
              full decision timeline
            </Link>
            , check the{" "}
            <Link href="/forecast" className="text-accent-green hover:underline">
              24-hour forecast
            </Link>{" "}
            that drives it, or{" "}
            <Link href="/copilot" className="text-accent-green hover:underline">
              ask the Copilot why any decision was made
            </Link>
            .
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
