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

/**
 * Competition-demo output/latency budget. Kept as named constants so the cost
 * and wait-time envelope lives in one place.
 *   - MAX_OUTPUT_TOKENS caps spend and keeps answers demo-length.
 *   - REQUEST_TIMEOUT_MS bounds how long a judge ever waits on Claude before the
 *     rule engine answers instead.
 */
export const MAX_OUTPUT_TOKENS = 512;
export const REQUEST_TIMEOUT_MS = 12_000;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      // Fail fast and let the rule engine answer rather than leaving the judge
      // staring at a typing indicator. maxRetries is 0 (not 1): the rule engine
      // already provides instant resilience, so a retry would only add up to
      // another REQUEST_TIMEOUT_MS to the wait for no benefit here. Bounded
      // latency and predictable cost are preferred for the public demo.
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return client;
}

export interface CopilotChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_INSTRUCTIONS = `You are the WeaveGrid AI operations copilot for a Virtual Power Plant (VPP) that coordinates a solar farm, wind turbine, hydro plant, battery array, EV charging hub, and smart building.

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
    max_tokens: MAX_OUTPUT_TOKENS,
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
