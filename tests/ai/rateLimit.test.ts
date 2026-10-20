import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake Upstash modules: nothing here can reach a real Redis. Each test programs
// what the fake Ratelimit/Redis return via the `fake` object below.
const fake = vi.hoisted(() => ({
  short: vi.fn<(id: string) => Promise<unknown>>(),
  daily: vi.fn<(id: string) => Promise<unknown>>(),
  get: vi.fn<(k: string) => Promise<unknown>>(),
  incr: vi.fn<(k: string) => Promise<unknown>>(),
  expire: vi.fn<(k: string, s: number) => Promise<unknown>>(),
  ratelimitConfigs: [] as Record<string, unknown>[],
  redisConfigs: [] as Record<string, unknown>[],
}));

vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: (config: Record<string, unknown>) => {
      fake.redisConfigs.push(config);
      return { get: fake.get, incr: fake.incr, expire: fake.expire };
    },
  },
}));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = () => "sliding";
    static fixedWindow = () => "fixed";
    private prefix: string;
    constructor(config: Record<string, unknown>) {
      fake.ratelimitConfigs.push(config);
      this.prefix = String(config.prefix);
    }
    limit(id: string) {
      return this.prefix.includes("short") ? fake.short(id) : fake.daily(id);
    }
  }
  return { Ratelimit };
});

import {
  AUTHORIZATION_DEADLINE_MS,
  CEILING_TTL_SECONDS,
  SHORT_WINDOW_LIMIT,
  __resetRateLimitBackendForTests,
  authorizeWithBackend,
  checkClaudeAllowance,
  interpretRatelimitResponse,
  reserveUnderCeiling,
  type CeilingStore,
  type LimitOutcome,
  type RateBackend,
} from "@/lib/ai/rateLimit";

const OK = { success: true, limit: 6, remaining: 5, reset: 0, pending: Promise.resolve() };
const LIMITED = { success: false, limit: 6, remaining: 0, reset: 0, pending: Promise.resolve() };
const LIB_TIMEOUT = { success: true, limit: 0, remaining: 0, reset: 0, pending: Promise.resolve(), reason: "timeout" };

function healthyRedis(counter: number | null = null) {
  fake.short.mockResolvedValue(OK);
  fake.daily.mockResolvedValue(OK);
  fake.get.mockResolvedValue(counter);
  fake.incr.mockResolvedValue((counter ?? 0) + 1);
  fake.expire.mockResolvedValue(1);
}

function useUpstash() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.invalid");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
}

beforeEach(() => {
  vi.resetAllMocks();
  fake.ratelimitConfigs.length = 0;
  fake.redisConfigs.length = 0;
  __resetRateLimitBackendForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Upstash-backed authorization (fake Redis)", () => {
  it("healthy Redis: authorizes and reserves one ceiling slot", async () => {
    useUpstash();
    healthyRedis(null);
    await expect(checkClaudeAllowance("1.2.3.4")).resolves.toEqual({ allow: true });
    expect(fake.incr).toHaveBeenCalledTimes(1);
    expect(fake.expire).toHaveBeenCalledWith(expect.stringMatching(/^weavegrid:claude:daily:/), CEILING_TTL_SECONDS);
  });

  it("disables the library's fail-open timeout and bounds every Redis request", async () => {
    useUpstash();
    healthyRedis();
    await checkClaudeAllowance("1.2.3.4");
    expect(fake.ratelimitConfigs).toHaveLength(2);
    for (const c of fake.ratelimitConfigs) expect(c.timeout).toBe(0);
    const redisConfig = fake.redisConfigs[0];
    expect(typeof redisConfig.signal).toBe("function"); // function form => aborts throw instead of faking a result
    expect((redisConfig.signal as () => AbortSignal)()).toBeInstanceOf(AbortSignal);
    expect(redisConfig.retry).toMatchObject({ retries: 1 });
  });

  it("rate limit exceeded: short window, daily per-IP and global ceiling all deny", async () => {
    useUpstash();
    healthyRedis();
    fake.short.mockResolvedValue(LIMITED);
    await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "short_window" });

    healthyRedis();
    fake.daily.mockResolvedValue(LIMITED);
    await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "daily_ip" });

    healthyRedis(200); // ceiling already exhausted: fast-path deny, no INCR
    fake.incr.mockClear();
    await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "global_ceiling" });
    expect(fake.incr).not.toHaveBeenCalled();
  });

  it('Redis timeout: the library\'s fail-open { success: true, reason: "timeout" } is denied', async () => {
    useUpstash();
    healthyRedis();
    fake.short.mockResolvedValue(LIB_TIMEOUT);
    await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "limiter_indeterminate" });
    healthyRedis();
    fake.daily.mockResolvedValue(LIB_TIMEOUT);
    await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "limiter_indeterminate" });
    expect(fake.incr).not.toHaveBeenCalled();
  });

  it("Redis timeout: a hung Redis is denied at the overall deadline", async () => {
    useUpstash();
    healthyRedis();
    await checkClaudeAllowance("warm-up"); // build the (fake) Upstash backend with real timers
    vi.useFakeTimers();
    fake.short.mockReturnValue(new Promise(() => {})); // never settles
    const pending = checkClaudeAllowance("ip");
    await vi.advanceTimersByTimeAsync(AUTHORIZATION_DEADLINE_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ allow: false, reason: "limiter_timeout" });
  });

  it("Redis connection failure: errors from any check deny", async () => {
    useUpstash();
    healthyRedis();
    fake.short.mockRejectedValue(new TypeError("fetch failed"));
    await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "redis_unavailable" });
    healthyRedis();
    fake.daily.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "redis_unavailable" });
  });

  it("indeterminate limiter results deny", async () => {
    useUpstash();
    for (const odd of [undefined, null, {}, { success: "true" }, { success: 1 }, { success: true, reason: "cacheBlock" }, "Aborted"]) {
      healthyRedis();
      fake.short.mockResolvedValue(odd);
      await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "limiter_indeterminate" });
    }
  });

  it("global daily-ceiling failures deny (GET/INCR/EXPIRE errors and placeholder values)", async () => {
    useUpstash();
    const cases: [string, () => void, string][] = [
      ["GET throws", () => fake.get.mockRejectedValue(new Error("down")), "redis_unavailable"],
      ["INCR throws", () => fake.incr.mockRejectedValue(new Error("down")), "redis_unavailable"],
      ["EXPIRE throws", () => fake.expire.mockRejectedValue(new Error("down")), "redis_unavailable"],
      ['GET returns "Aborted"', () => fake.get.mockResolvedValue("Aborted"), "limiter_indeterminate"],
      ['INCR returns "Aborted"', () => fake.incr.mockResolvedValue("Aborted"), "limiter_indeterminate"],
      ["INCR returns 0", () => fake.incr.mockResolvedValue(0), "limiter_indeterminate"],
      ["INCR returns NaN", () => fake.incr.mockResolvedValue(Number.NaN), "limiter_indeterminate"],
    ];
    for (const [, program, reason] of cases) {
      healthyRedis(null);
      program();
      await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason });
    }
  });

  it("production without Upstash credentials denies without loading Upstash", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(checkClaudeAllowance("ip")).resolves.toEqual({ allow: false, reason: "redis_unconfigured" });
    expect(fake.redisConfigs).toHaveLength(0);
  });
});

describe("authorizeWithBackend (whole-path deadline)", () => {
  const backend = (o: Partial<Record<keyof RateBackend, () => Promise<LimitOutcome>>>): RateBackend => ({
    shortLimit: o.shortLimit ?? (async () => "allow"),
    dailyLimit: o.dailyLimit ?? (async () => "allow"),
    underCeiling: o.underCeiling ?? (async () => "allow"),
  });
  const after = (ms: number, v: LimitOutcome) => () => new Promise<LimitOutcome>((r) => setTimeout(() => r(v), ms));

  it("the deadline covers the SUM of the checks, not each check separately", async () => {
    vi.useFakeTimers();
    // Each check alone is under the deadline, together they exceed it.
    const slow = backend({ shortLimit: after(1000, "allow"), dailyLimit: after(1000, "allow"), underCeiling: after(1000, "allow") });
    const p = authorizeWithBackend(slow, "ip", { ceiling: 200 });
    await vi.advanceTimersByTimeAsync(AUTHORIZATION_DEADLINE_MS);
    await expect(p).resolves.toEqual({ allow: false, reason: "limiter_timeout" });
  });

  it("a late 'allow' after the deadline can never authorize", async () => {
    vi.useFakeTimers();
    const p = authorizeWithBackend(backend({ underCeiling: after(AUTHORIZATION_DEADLINE_MS + 10, "allow") }), "ip", { ceiling: 200 });
    await vi.advanceTimersByTimeAsync(AUTHORIZATION_DEADLINE_MS + 50);
    await expect(p).resolves.toEqual({ allow: false, reason: "limiter_timeout" });
  });

  it("fast healthy checks authorize well within the deadline", async () => {
    await expect(authorizeWithBackend(backend({}), "ip", { ceiling: 200 })).resolves.toEqual({ allow: true });
  });
});

describe("pure helpers", () => {
  it("interpretRatelimitResponse only accepts a plain success", () => {
    expect(interpretRatelimitResponse(OK)).toBe("allow");
    expect(interpretRatelimitResponse(LIMITED)).toBe("deny");
    expect(interpretRatelimitResponse(LIB_TIMEOUT)).toBe("indeterminate");
    expect(interpretRatelimitResponse(undefined)).toBe("indeterminate");
  });

  it("reserveUnderCeiling allows up to the limit and never past it", async () => {
    let n = 0;
    const store: CeilingStore = {
      get: async () => (n === 0 ? null : n),
      incr: async () => ++n,
      expire: async () => 1,
    };
    const results: LimitOutcome[] = [];
    for (let i = 0; i < 4; i++) results.push(await reserveUnderCeiling(store, "k", 3));
    expect(results).toEqual(["allow", "allow", "allow", "deny"]);
  });
});

describe("in-memory development backend (unchanged behaviour)", () => {
  it("allows in development without Upstash and still enforces the short-window limit", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const ip = `dev-${Math.random()}`;
    const results = [];
    for (let i = 0; i <= SHORT_WINDOW_LIMIT; i++) results.push(await checkClaudeAllowance(ip));
    expect(results.slice(0, SHORT_WINDOW_LIMIT).every((r) => r.allow)).toBe(true);
    expect(results[SHORT_WINDOW_LIMIT]).toEqual({ allow: false, reason: "short_window" });
    expect(fake.redisConfigs).toHaveLength(0);
  });
});
