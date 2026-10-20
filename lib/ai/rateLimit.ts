/**
 * Durable, fail-safe rate limiting + global usage ceiling for the WeaveGrid
 * Copilot's paid Claude pathway. Server-only.
 *
 * Design goals (MAIC Nexus public judge demo):
 *   - Judges can genuinely exercise the Claude Copilot, but no visitor can turn
 *     it into an unlimited free chatbot or burn unlimited Anthropic credit.
 *   - Every block degrades gracefully to the rule engine — never a broken chat.
 *   - Production durability uses Upstash Redis (works on serverless/Vercel).
 *   - Local development does NOT require Redis: an in-process backend enforces
 *     the same limits so behaviour can be tested without any credentials.
 *   - Fail-closed: if the limiter cannot reach a DEFINITIVE "allowed" answer —
 *     Redis down, slow, timed out, or returning anything unexpected — we DENY the
 *     Claude call (fall back to rules) rather than risk unlimited access.
 *
 * Only the Copilot API consumes this — the rest of the WeaveGrid site is never
 * rate limited. Credentials come from env only (never hard-coded, never logged).
 */

// --- Tunable limits (clearly named; no scattered magic numbers) --------------

/** Short-window burst limit: Claude-eligible calls per 10 minutes per IP. */
export const SHORT_WINDOW_LIMIT = 6;
export const SHORT_WINDOW = "10 m" as const;

/** Daily per-IP limit: Claude-eligible calls per calendar day per IP. */
export const DAILY_IP_LIMIT = 20;
export const DAILY_WINDOW = "1 d" as const;

/**
 * Hard deadline for the WHOLE authorization path (short window + daily per-IP +
 * global ceiling, every Redis round trip included). If no definitive answer has
 * been reached by then, the call is denied and the rule engine answers.
 */
export const AUTHORIZATION_DEADLINE_MS = 2_500;

/** Per-HTTP-request abort for Upstash calls, so one hung request cannot eat the whole budget. */
export const REDIS_REQUEST_TIMEOUT_MS = 1_000;

/** One quick retry for transient network errors; anything slower is denied by the deadline. */
export const REDIS_RETRIES = 1;
export const REDIS_RETRY_BACKOFF_MS = 50;

/** Global daily ceiling across ALL visitors. Env-overridable; default 200. */
export function globalDailyCeiling(): number {
  const raw = process.env.ANTHROPIC_DAILY_CALL_LIMIT;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 200;
}

export type ClaudeGateReason =
  | "short_window"
  | "daily_ip"
  | "global_ceiling"
  | "redis_unavailable"
  | "redis_unconfigured"
  | "limiter_timeout"
  | "limiter_indeterminate";

export interface ClaudeGateResult {
  allow: boolean;
  reason?: ClaudeGateReason;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

/** True when a durable Redis store backs the limits (i.e. production-grade). */
export function isDurableRateLimitConfigured(): boolean {
  return upstashConfigured();
}

// --- Backend abstraction ------------------------------------------------------
// Each check returns a three-way outcome. Only "allow" lets the call proceed;
// "deny" is a genuine limit hit, "indeterminate" is anything we cannot trust
// (and is treated exactly like a deny).

export type LimitOutcome = "allow" | "deny" | "indeterminate";

export interface RateBackend {
  shortLimit(ip: string): Promise<LimitOutcome>;
  dailyLimit(ip: string): Promise<LimitOutcome>;
  underCeiling(limit: number): Promise<LimitOutcome>;
}

function today(): string {
  // Date-scoped key (UTC) so the ceiling resets daily; TTL is a safety net.
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** How long the daily-ceiling key survives (~26h covers timezone drift). */
export const CEILING_TTL_SECONDS = 60 * 60 * 26;

/** Shape of an @upstash/ratelimit response that matters for the decision. */
export interface RatelimitLikeResponse {
  success?: unknown;
  reason?: unknown;
}

/**
 * Interpret a @upstash/ratelimit response strictly.
 *
 * The library resolves `{ success: true, reason: "timeout" }` when its own
 * timeout fires — i.e. it fails OPEN. We only accept a plain, reason-less
 * `success === true` as an allow; an explicit `success === false` is a real limit
 * hit; everything else (timeouts, missing/odd fields) is indeterminate.
 */
export function interpretRatelimitResponse(res: RatelimitLikeResponse | null | undefined): LimitOutcome {
  if (!res || typeof res !== "object") return "indeterminate";
  if (res.success === false) return "deny";
  if (res.success === true && res.reason === undefined) return "allow";
  return "indeterminate";
}

/** Minimal atomic counter surface the ceiling needs (satisfied by @upstash/redis). */
export interface CeilingStore {
  get(key: string): Promise<unknown>;
  incr(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** Parse a stored counter: null (no key yet) or a non-negative integer; anything else is untrusted. */
function parseCounter(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined; // indeterminate (e.g. an "Aborted" placeholder)
}

/**
 * Reserve one slot under the global daily ceiling, race-safely and without
 * inflating the counter once the ceiling is already exhausted.
 *
 *   - Fast path: a GET short-circuits an already-exhausted day so repeated
 *     denied requests do NOT keep INCRementing the counter unboundedly.
 *   - Reservation: the atomic INCR return value is authoritative for the allow
 *     decision, so concurrent callers at the boundary can never exceed `limit`
 *     actual Claude opportunities (the GET only ever early-denies, never
 *     early-allows). A failed Anthropic call still consumes its reserved slot.
 *   - Any value that is not a well-formed counter is indeterminate (deny).
 *
 * Returns "allow" only when this caller definitively holds a slot within the ceiling.
 */
export async function reserveUnderCeiling(
  store: CeilingStore,
  key: string,
  limit: number
): Promise<LimitOutcome> {
  const current = parseCounter(await store.get(key));
  if (current === undefined) return "indeterminate";
  if (current !== null && current >= limit) return "deny"; // exhausted — no write
  const n = parseCounter(await store.incr(key));
  if (n === undefined || n === null || n < 1) return "indeterminate";
  if (n === 1) await store.expire(key, CEILING_TTL_SECONDS);
  return n <= limit ? "allow" : "deny";
}

// --- Upstash (durable, serverless-compatible) backend ------------------------

let upstashBackend: RateBackend | null = null;

async function getUpstashBackend(): Promise<RateBackend> {
  if (upstashBackend) return upstashBackend;
  // Lazy import so local dev without Upstash never loads these modules.
  const { Redis } = await import("@upstash/redis");
  const { Ratelimit } = await import("@upstash/ratelimit");

  // reads UPSTASH_REDIS_REST_URL / _TOKEN. The signal must be a FUNCTION: with a
  // plain AbortSignal the client turns an abort into a fake successful result
  // ("Aborted") instead of throwing.
  const redis = Redis.fromEnv({
    signal: () => AbortSignal.timeout(REDIS_REQUEST_TIMEOUT_MS),
    retry: { retries: REDIS_RETRIES, backoff: () => REDIS_RETRY_BACKOFF_MS },
  });
  // timeout: 0 disables the library's fail-OPEN timeout; the overall
  // authorization deadline below bounds latency instead.
  const short = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(SHORT_WINDOW_LIMIT, SHORT_WINDOW),
    prefix: "weavegrid:rl:short",
    analytics: false,
    timeout: 0,
  });
  const daily = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(DAILY_IP_LIMIT, DAILY_WINDOW),
    prefix: "weavegrid:rl:daily",
    analytics: false,
    timeout: 0,
  });

  upstashBackend = {
    async shortLimit(ip) {
      return interpretRatelimitResponse(await short.limit(ip));
    },
    async dailyLimit(ip) {
      return interpretRatelimitResponse(await daily.limit(ip));
    },
    async underCeiling(limit) {
      const key = `weavegrid:claude:daily:${today()}`;
      return reserveUnderCeiling(
        {
          get: (k) => redis.get(k),
          incr: (k) => redis.incr(k),
          expire: (k, s) => redis.expire(k, s),
        },
        key,
        limit
      );
    },
  };
  return upstashBackend;
}

// --- In-memory (local development only) backend ------------------------------
// Single-process, non-durable. Never used in production — production without
// Upstash fails safe to DENY instead of using this.

const memHits = new Map<string, number[]>(); // ip -> recent short-window timestamps
const memDaily = new Map<string, { date: string; count: number }>();
let memCeiling = { date: today(), count: 0 };

const memoryBackend: RateBackend = {
  async shortLimit(ip) {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const hits = (memHits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= SHORT_WINDOW_LIMIT) {
      memHits.set(ip, hits);
      return "deny";
    }
    hits.push(now);
    memHits.set(ip, hits);
    return "allow";
  },
  async dailyLimit(ip) {
    const d = today();
    const rec = memDaily.get(ip);
    const cur = rec && rec.date === d ? rec.count : 0;
    if (cur >= DAILY_IP_LIMIT) {
      memDaily.set(ip, { date: d, count: cur });
      return "deny";
    }
    memDaily.set(ip, { date: d, count: cur + 1 });
    return "allow";
  },
  async underCeiling(limit) {
    const d = today();
    if (memCeiling.date !== d) memCeiling = { date: d, count: 0 };
    // Mirror the Redis fast path: once exhausted, deny without inflating the
    // counter. Node's single-threaded loop makes this check-then-inc atomic.
    if (memCeiling.count >= limit) return "deny";
    memCeiling.count += 1;
    return memCeiling.count <= limit ? "allow" : "deny";
  },
};

/**
 * Resolve which backend to use.
 *   - Upstash configured        -> durable Upstash backend (any environment)
 *   - Not configured + dev       -> in-memory backend (so local testing works)
 *   - Not configured + production -> null (caller must fail safe to rules)
 */
async function getBackend(): Promise<RateBackend | null> {
  if (upstashConfigured()) return getUpstashBackend();
  if (!isProduction()) return memoryBackend;
  return null; // production must not run unlimited without a durable store
}

const LIMIT_REASON: Record<"short" | "daily" | "ceiling", ClaudeGateReason> = {
  short: "short_window",
  daily: "daily_ip",
  ceiling: "global_ceiling",
};

/**
 * Run all three checks against a backend under ONE deadline. Only a definitive
 * "allow" from every check authorizes the call; a limit hit, an indeterminate
 * result, a thrown error, or the deadline passing all deny.
 */
export async function authorizeWithBackend(
  backend: RateBackend,
  ip: string,
  options: { ceiling: number; deadlineMs?: number }
): Promise<ClaudeGateResult> {
  const deadlineMs = options.deadlineMs ?? AUTHORIZATION_DEADLINE_MS;

  const decide = async (): Promise<ClaudeGateResult> => {
    const steps: ["short" | "daily" | "ceiling", () => Promise<LimitOutcome>][] = [
      ["short", () => backend.shortLimit(ip)],
      ["daily", () => backend.dailyLimit(ip)],
      ["ceiling", () => backend.underCeiling(options.ceiling)],
    ];
    for (const [name, run] of steps) {
      const outcome = await run();
      if (outcome === "deny") return { allow: false, reason: LIMIT_REASON[name] };
      if (outcome !== "allow") return { allow: false, reason: "limiter_indeterminate" };
    }
    return { allow: true };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ClaudeGateResult>((resolve) => {
    timer = setTimeout(() => resolve({ allow: false, reason: "limiter_timeout" }), deadlineMs);
  });
  const decision = decide().catch((err): ClaudeGateResult => {
    // Redis/network failure. Cost protection matters more than availability of
    // the AI path: deny in every environment (rules still answer).
    console.error("[rateLimit] limiter unavailable; failing closed:", err);
    return { allow: false, reason: "redis_unavailable" };
  });
  try {
    return await Promise.race([decision, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The single gate the Copilot consults right before a genuine Claude call.
 * Consuming a token here represents an actual opportunity to spend Anthropic
 * credit (scope + injection checks have already passed upstream), so harmless
 * page loads and off-topic questions never reach this function.
 */
export async function checkClaudeAllowance(ip: string): Promise<ClaudeGateResult> {
  let backend: RateBackend | null;
  try {
    backend = await getBackend();
  } catch (err) {
    console.error("[rateLimit] limiter backend could not be created; failing closed:", err);
    return { allow: false, reason: "redis_unavailable" };
  }
  if (!backend) {
    // Production with no durable store configured — fail safe.
    return { allow: false, reason: "redis_unconfigured" };
  }
  return authorizeWithBackend(backend, ip, { ceiling: globalDailyCeiling() });
}

/** Test-only: drop the cached Upstash backend so a test can rebuild it with new mocks/env. */
export function __resetRateLimitBackendForTests(): void {
  upstashBackend = null;
}

/**
 * Resolve the visitor IP from trusted deployment headers, preferring Vercel's
 * forwarded header when deployed, with a local-development fallback. Never
 * stores or logs the value beyond using it as a rate-limit key.
 */
export function resolveClientIp(headers: Headers): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "local-dev";
}
