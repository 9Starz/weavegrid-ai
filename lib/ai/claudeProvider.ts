import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude provider for the copilot. Server-only: the API key is read from the
 * ANTHROPIC_API_KEY environment variable and never leaves this module — this file
 * must only ever be imported from API routes / server code, never from client
 * components.
 *
 * The caller (lib/ai/copilot.ts) treats any throw from answerWithClaude() as a
 * signal to fall back to the deterministic rule engine, so error handling here is
 * deliberately strict: bad output shapes throw rather than returning something odd.
 */

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Single source of truth for the Copilot's Claude model. Change it here only —
 * do not inline model IDs anywhere else. Haiku 4.5 is a lightweight, low-cost,
 * fast model well suited to short, grounded demo Q&A.
 */
export const COPILOT_MODEL = "claude-haiku-4-5";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      // Chat UX budget: fail fast and let the rule engine answer instead of
      // leaving the user staring at a typing indicator. Timeout is per attempt.
      timeout: 20_000,
      maxRetries: 1,
    });
  }
  return client;
}

export interface CopilotChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_INSTRUCTIONS = `You are the WattSync AI operations copilot for a Virtual Power Plant (VPP) that coordinates a solar farm, wind turbine, hydro plant, battery array, EV charging hub, and smart building.

Ground every answer strictly in the LIVE FLEET DATA JSON below — it is a real-time snapshot of the fleet's simulation, 24h forecast, recommendations, optimization decisions, and before/after comparison. Cite specific numbers from it (kW/MW, $, %, kg CO2, times). If the data does not cover a question, say so plainly rather than inventing figures. Never fabricate a number.

Style: 2-5 sentences, plain English for an operations audience, no markdown headers or bullet lists — flowing prose like a knowledgeable colleague. Convert hour-of-day numbers to clock time (e.g. 18.5 -> 6:30PM). Power values are in kW unless noted; format >=1000 kW as MW.

Domain grounding: all monetary values are in Malaysian Ringgit (RM) — always format money as RM (e.g. RM1,277), never $. On-peak electricity (4-9pm) costs RM0.34/kWh vs RM0.11/kWh off-peak; grid carbon intensity is 0.4 kg CO2/kWh; "before" figures are the same day simulated without AI coordination, "after" is with it.`;

export async function answerWithClaude(
  history: CopilotChatMessage[],
  contextJson: string
): Promise<string> {
  const anthropic = getClient();

  // Claude requires the first message to be from the user; drop any leading
  // assistant greeting the chat UI sends along.
  const firstUser = history.findIndex((m) => m.role === "user");
  if (firstUser === -1) throw new Error("No user message in history");
  const messages = history.slice(firstUser).map((m) => ({ role: m.role, content: m.content }));

  const response = await anthropic.messages.create({
    model: COPILOT_MODEL,
    max_tokens: 1024,
    system: `${SYSTEM_INSTRUCTIONS}\n\nLIVE FLEET DATA:\n${contextJson}`,
    messages,
  });

  if (response.stop_reason === "refusal") throw new Error("Claude refused the request");

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) throw new Error("Empty Claude response");
  return text;
}
