/**
 * Application-level guards for the WeaveGrid Copilot's Claude pathway.
 *
 * Two lightweight, deterministic checks run BEFORE any paid Claude call:
 *   1. isInScope()        — is the question about WeaveGrid's energy domain?
 *   2. looksLikeInjection() — is it an obvious attempt to jailbreak / exfiltrate?
 *
 * Both are intentionally simple keyword/pattern checks, not a brittle blacklist.
 * Their only job is to keep obviously off-topic or abusive requests from
 * consuming Anthropic credit. The Claude system prompt remains the authoritative
 * instruction layer for everything that does reach the model. These helpers are
 * self-contained (no simulation imports) so they can be unit-tested in isolation.
 */

/**
 * Domain vocabulary for the WeaveGrid VPP: renewable generation, storage, EVs,
 * smart buildings, grid, forecasting, optimisation, tariffs, carbon, and the
 * Project Development Intelligence surface. Kept broad on purpose — a judge
 * asking a natural-language energy question must not be rejected on wording.
 */
const DOMAIN_KEYWORDS: string[] = [
  // energy / renewables / generation
  "energy", "renewable", "renewables", "clean", "green", "generation", "generate",
  "generating", "power", "solar", "pv", "panel", "panels", "inverter", "wind",
  "turbine", "hydro", "plant",
  // storage / battery
  "battery", "batteries", "bess", "storage", "store", "storing", "stored",
  "charge", "charging", "discharge", "discharging", "soc", "state of charge",
  // ev / buildings
  "ev", "vehicle", "vehicles", "charger", "chargers", "building", "buildings",
  "hvac", "smart building",
  // grid / demand / dispatch
  "grid", "import", "imports", "importing", "export", "exports", "exporting",
  "demand", "load", "dispatch", "consumption", "meter", "metering",
  // vpp / optimisation
  "vpp", "virtual power plant", "optimise", "optimize", "optimisation",
  "optimization", "optimizing", "optimising", "coordinate", "coordination",
  // forecast / validation
  "forecast", "forecasts", "forecasting", "predict", "prediction", "outlook",
  "surplus", "shortage", "validation", "accuracy",
  // assets / health
  "asset", "assets", "fleet", "health", "alert", "alerts", "performance",
  "underperform", "underperforming", "capacity", "utilisation", "utilization",
  "degradation", "maintenance",
  // tariffs / savings / carbon
  "tariff", "tariffs", "price", "pricing", "priced", "peak", "off-peak",
  "offpeak", "rate", "cost", "save", "saving", "savings", "ringgit", "rm",
  "carbon", "co2", "emission", "emissions",
  // weather drivers
  "weather", "cloud", "cloudy", "sun", "sunny", "rain", "irradiance",
  // project development intelligence
  "feasibility", "site", "screening", "development", "project",
  // product / operations
  "weavegrid", "wattsync", "recommend", "recommendation", "recommendations",
  "kw", "mw", "kwh", "mwh",
];

// Multi-word phrases must be matched as substrings; single words are matched on
// word boundaries so "rm" doesn't fire inside "form" or "ev" inside "level".
const PHRASE_KEYWORDS = DOMAIN_KEYWORDS.filter((k) => k.includes(" ") || k.includes("-"));
const WORD_KEYWORDS = DOMAIN_KEYWORDS.filter((k) => !k.includes(" ") && !k.includes("-"));
const WORD_KEYWORD_SET = new Set(WORD_KEYWORDS);

/** True when the question is reasonably related to the WeaveGrid energy domain. */
export function isInScope(question: string): boolean {
  const q = question.toLowerCase();
  for (const phrase of PHRASE_KEYWORDS) {
    if (q.includes(phrase)) return true;
  }
  // Tokenise on non-letters/digits and test each token against the word set.
  const tokens = q.split(/[^a-z0-9]+/);
  for (const token of tokens) {
    if (token && WORD_KEYWORD_SET.has(token)) return true;
  }
  return false;
}

/**
 * Obvious prompt-injection / exfiltration / "become a general chatbot" patterns.
 * Deliberately small: this is a coarse net for blatant abuse, not a sanitiser
 * for ordinary questions. Anything subtle is left to Claude's own robustness and
 * the grounded system prompt.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+|your\s+|the\s+)?(previous|prior|earlier|above|preceding)?\s*(instructions?|prompts?|rules?|context)/i,
  /disregard\s+(all\s+|any\s+|your\s+|the\s+)?(previous|prior|earlier|above)?\s*(instructions?|prompts?|rules?)/i,
  /forget\s+(all\s+|everything\s+|your\s+)?(previous|prior|above)?\s*(instructions?|prompts?|rules?)/i,
  /(reveal|show|print|expose|leak|repeat|display|reprint|output)\s+(me\s+)?(your\s+|the\s+|all\s+|any\s+)?(system|hidden|initial|internal|original|secret)\s*(prompt|instructions?|message|rules?)/i,
  /what\s+(is|are|was|were)\s+(your\s+)?(system\s+|initial\s+|original\s+|hidden\s+)?(prompt|instructions?)/i,
  /(reveal|show|print|expose|leak|give\s+me|tell\s+me|what\s+is)\s+.{0,40}(api\s*key|secret|token|credential|password|env\b|environment\s+variable)/i,
  /act\s+as\s+(a\s+|an\s+)?(general|generic|different|unrestricted|normal|standard|plain)\s+(chatbot|assistant|ai|claude|model|llm)/i,
  /(you\s+are\s+now|from\s+now\s+on\s+you('?re|\s+are))\s+.{0,40}(chatbot|assistant|dan|unrestricted|jailbroken|no\s+longer)/i,
  /(jailbreak|developer\s+mode|dan\s+mode|do\s+anything\s+now)/i,
  /(pretend|imagine)\s+(you\s+are|to\s+be)\s+.{0,40}(not|no\s+longer|different|another|unrestricted)/i,
];

/** True when the question is an obvious jailbreak / secret-exfiltration attempt. */
export function looksLikeInjection(question: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(question));
}

/**
 * Safe, non-disclosing redirect returned (via rules mode) when a question is out
 * of scope or an obvious injection attempt. Contains no security terminology and
 * reveals nothing about the system prompt or protections.
 */
export const SCOPE_REDIRECT_MESSAGE =
  "I'm the WeaveGrid AI Copilot, so I focus on this energy fleet — its forecasts, " +
  "assets, savings and optimisation. Ask me about the current VPP operation, a " +
  "recommendation, or why the system is dispatching the way it is.";
