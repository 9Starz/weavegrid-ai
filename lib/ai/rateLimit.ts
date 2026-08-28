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
 *   - Fail-safe: in production, if the limiter cannot safely decide, we DENY the
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
  | "redis_unconfigured";

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
// A backend returns `true` when a call is ALLOWED and `false` when the relevant
// limit is reached. Ceiling reservation is atomic where the store allows it.

interface RateBackend {
  shortLimit(ip: string): Promise<boolean>;
  dailyLimit(ip: string): Promise<boolean>;
  underCeiling(limit: number): Promise<boolean>;
}

function today(): string {
  // Date-scoped key (UTC) so the ceiling resets daily; TTL is a safety net.
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** How long the daily-ceiling key survives (~26h covers timezone drift). */
export const CEILING_TTL_SECONDS = 60 * 60 * 26;

/** Minimal atomic counter surface the ceiling needs (satisfied by @upstash/redis). */
export interface CeilingStore {
  get(key: string): Promise<number | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
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
 *
 * Returns true when this caller holds a slot within the ceiling.
 */
export async function reserveUnderCeiling(
  store: CeilingStore,
  key: string,
  limit: number
): Promise<boolean> {
  const current = await store.get(key);
  if (current !== null && current >= limit) return false; // exhausted — no write
  const n = await store.incr(key);
  if (n === 1) await store.expire(key, CEILING_TTL_SECONDS);
  return n <= limit;
}

// --- Upstash (durable, serverless-compatible) backend ------------------------

let upstashBackend: RateBackend | null = null;

async function getUpstashBackend(): Promise<RateBackend> {
  if (upstashBackend) return upstashBackend;
  // Lazy import so local dev without Upstash never loads these modules.
  const { Redis } = await import("@upstash/redis");
  const { Ratelimit } = await import("@upstash/ratelimit");

  const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / _TOKEN
  const short = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(SHORT_WINDOW_LIMIT, SHORT_WINDOW),
    prefix: "weavegrid:rl:short",
    analytics: false,
  });
  const daily = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(DAILY_IP_LIMIT, DAILY_WINDOW),
    prefix: "weavegrid:rl:daily",
    analytics: false,
  });

  upstashBackend = {
    async shortLimit(ip) {
      return (await short.limit(ip)).success;
    },
    async dailyLimit(ip) {
      return (await daily.limit(ip)).success;
    },
    async underCeiling(limit) {
      const key = `weavegrid:claude:daily:${today()}`;
      return reserveUnderCeiling(
        {
          get: (k) => redis.get<number>(k),
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
      return false;
    }
    hits.push(now);
    memHits.set(ip, hits);
    return true;
  },
  async dailyLimit(ip) {
    const d = today();
    const rec = memDaily.get(ip);
    const cur = rec && rec.date === d ? rec.count : 0;
    if (cur >= DAILY_IP_LIMIT) {
      memDaily.set(ip, { date: d, count: cur });
      return false;
    }
    memDaily.set(ip, { date: d, count: cur + 1 });
    return true;
  },
  async underCeiling(limit) {
    const d = today();
    if (memCeiling.date !== d) memCeiling = { date: d, count: 0 };
    // Mirror the Redis fast path: once exhausted, deny without inflating the
    // counter. Node's single-threaded loop makes this check-then-inc atomic.
    if (memCeiling.count >= limit) return false;
    memCeiling.count += 1;
    return memCeiling.count <= limit;
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

/**
 * The single gate the Copilot consults right before a genuine Claude call.
 * Consuming a token here represents an actual opportunity to spend Anthropic
 * credit (scope + injection checks have already passed upstream), so harmless
 * page loads and off-topic questions never reach this function.
 */
export async function checkClaudeAllowance(ip: string): Promise<ClaudeGateResult> {
  const backend = await getBackend();
  if (!backend) {
    // Production with no durable store configured — fail safe.
    return { allow: false, reason: "redis_unconfigured" };
  }
  try {
    if (!(await backend.shortLimit(ip))) return { allow: false, reason: "short_window" };
    if (!(await backend.dailyLimit(ip))) return { allow: false, reason: "daily_ip" };
    if (!(await backend.underCeiling(globalDailyCeiling())))
      return { allow: false, reason: "global_ceiling" };
    return { allow: true };
  } catch (err) {
    // Redis/network failure. Cost protection matters more than availability of
    // the AI path: in production, deny (rules still answer). In development,
    // allow so a flaky local store doesn't block iteration.
    console.error("[rateLimit] limiter unavailable; failing safe:", err);
    if (isProduction()) return { allow: false, reason: "redis_unavailable" };
    return { allow: true, reason: "redis_unavailable" };
  }
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
