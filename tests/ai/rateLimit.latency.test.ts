import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTHORIZATION_DEADLINE_MS,
  __resetRateLimitBackendForTests,
  authorizeWithBackend,
  checkClaudeAllowance,
  type LimitOutcome,
  type RateBackend,
} from "@/lib/ai/rateLimit";

// Real @upstash/redis + @upstash/ratelimit clients pointed at throwaway LOCALHOST
// servers — never at Upstash. Measures how long a Redis failure takes to fall
// back to the rule engine end-to-end.
const servers: Server[] = [];

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

function pointUpstashAt(url: string) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", url);
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "local-test-token");
  vi.stubEnv("UPSTASH_DISABLE_TELEMETRY", "1");
}

async function timed() {
  const t0 = performance.now();
  const result = await checkClaudeAllowance("203.0.113.7");
  return { result, ms: Math.round(performance.now() - t0) };
}

beforeEach(() => {
  __resetRateLimitBackendForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

describe("fail-closed latency against local fake Redis endpoints", () => {
  it("hung Redis (accepts, never responds): denied in about 1–2.5 s", async () => {
    pointUpstashAt(await listen(() => {}));
    const { result, ms } = await timed();
    console.info(`[latency] hung Redis -> ${JSON.stringify(result)} in ${ms} ms`);
    expect(result.allow).toBe(false);
    expect(ms).toBeLessThan(3_000);
  }, 10_000);

  it("connection refused: denied almost immediately", async () => {
    pointUpstashAt(await closedPortUrl());
    const { result, ms } = await timed();
    console.info(`[latency] connection refused -> ${JSON.stringify(result)} in ${ms} ms`);
    expect(result).toEqual({ allow: false, reason: "redis_unavailable" });
    expect(ms).toBeLessThan(1_000);
  }, 10_000);

  it("HTTP 5xx from Redis: denied", async () => {
    pointUpstashAt(await listen((_req, res) => { res.writeHead(503, { "content-type": "application/json" }); res.end('{"error":"archived"}'); }));
    const { result, ms } = await timed();
    console.info(`[latency] HTTP 503 -> ${JSON.stringify(result)} in ${ms} ms`);
    expect(result.allow).toBe(false);
    expect(ms).toBeLessThan(1_000);
  }, 10_000);

  it('junk 200 responses (e.g. {"result":"Aborted"}): denied, never authorized', async () => {
    pointUpstashAt(await listen((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"result":"Aborted"}'); }));
    const { result, ms } = await timed();
    console.info(`[latency] junk results -> ${JSON.stringify(result)} in ${ms} ms`);
    expect(result.allow).toBe(false);
  }, 10_000);

  it("slow Redis with malformed replies (900 ms each): denied", async () => {
    pointUpstashAt(await listen((_req, res) => { setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"result":1}'); }, 900); }));
    const { result, ms } = await timed();
    console.info(`[latency] slow malformed Redis -> ${JSON.stringify(result)} in ${ms} ms`);
    expect(result.allow).toBe(false);
    expect(ms).toBeLessThan(3_000);
  }, 10_000);
});

describe("whole-path deadline on the real clock", () => {
  it("three individually-acceptable 1 s checks are cut off at the 2.5 s deadline", async () => {
    const slow = () => new Promise<LimitOutcome>((r) => setTimeout(() => r("allow"), 1_000));
    const backend: RateBackend = { shortLimit: slow, dailyLimit: slow, underCeiling: slow };
    const t0 = performance.now();
    const result = await authorizeWithBackend(backend, "ip", { ceiling: 200 });
    const ms = Math.round(performance.now() - t0);
    console.info(`[latency] 3 x 1 s checks -> ${JSON.stringify(result)} in ${ms} ms`);
    expect(result).toEqual({ allow: false, reason: "limiter_timeout" });
    expect(ms).toBeGreaterThanOrEqual(AUTHORIZATION_DEADLINE_MS - 20);
    expect(ms).toBeLessThan(AUTHORIZATION_DEADLINE_MS + 300);
  }, 10_000);
});
