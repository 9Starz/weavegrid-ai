import { beforeEach, describe, expect, it, vi } from "vitest";

// The Copilot must never reach Anthropic when the rate-limit gate denies.
// Both the Claude provider and the gate are mocked: no network, no credentials.
const mocks = vi.hoisted(() => ({
  answerWithClaude: vi.fn(async () => "claude reply"),
  checkClaudeAllowance: vi.fn(),
}));

vi.mock("@/lib/ai/claudeProvider", () => ({
  COPILOT_MODEL: "test-model",
  isClaudeConfigured: () => true,
  answerWithClaude: mocks.answerWithClaude,
}));

vi.mock("@/lib/ai/rateLimit", () => ({
  checkClaudeAllowance: mocks.checkClaudeAllowance,
}));

import { answerQuestion } from "@/lib/ai/copilot";

const IN_SCOPE = "What is the solar forecast for tomorrow?";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Copilot gate", () => {
  it.each([
    "short_window",
    "daily_ip",
    "global_ceiling",
    "redis_unavailable",
    "redis_unconfigured",
    "limiter_timeout",
    "limiter_indeterminate",
  ])("denied authorization (%s) falls back to the rule engine and never calls Anthropic", async (reason) => {
    mocks.checkClaudeAllowance.mockResolvedValue({ allow: false, reason });
    const res = await answerQuestion(IN_SCOPE, [{ role: "user", content: IN_SCOPE }], { ip: "1.2.3.4" });
    expect(res.mode).toBe("rules");
    expect(res.reply.length).toBeGreaterThan(0);
    expect(mocks.checkClaudeAllowance).toHaveBeenCalledWith("1.2.3.4");
    expect(mocks.answerWithClaude).not.toHaveBeenCalled();
  });

  it("a gate that throws still never reaches Anthropic", async () => {
    mocks.checkClaudeAllowance.mockRejectedValue(new Error("boom"));
    await expect(answerQuestion(IN_SCOPE, undefined, { ip: "1.2.3.4" })).rejects.toThrow();
    expect(mocks.answerWithClaude).not.toHaveBeenCalled();
  });

  it("control: an allowed request is the only path that calls Anthropic (mocked)", async () => {
    mocks.checkClaudeAllowance.mockResolvedValue({ allow: true });
    const res = await answerQuestion(IN_SCOPE, undefined, { ip: "1.2.3.4" });
    expect(res).toEqual({ reply: "claude reply", mode: "claude" });
    expect(mocks.answerWithClaude).toHaveBeenCalledTimes(1);
  });

  it("off-topic questions never consult the gate or Anthropic", async () => {
    const res = await answerQuestion("Write me a poem about cats", undefined, { ip: "1.2.3.4" });
    expect(res.mode).toBe("rules");
    expect(mocks.checkClaudeAllowance).not.toHaveBeenCalled();
    expect(mocks.answerWithClaude).not.toHaveBeenCalled();
  });
});
