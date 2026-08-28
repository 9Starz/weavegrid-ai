import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/ai/copilot";
import { CopilotChatMessage } from "@/lib/ai/claudeProvider";
import { resolveClientIp } from "@/lib/ai/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Server-side input guards (never trust the frontend). These bound how large a
 * Claude prompt a visitor can create, independent of what the browser sends.
 *   - MAX_HISTORY_TURNS: how many recent user+assistant messages are retained.
 *   - MAX_MESSAGE_CHARS: per-message character cap (each message is truncated).
 *   - MAX_TOTAL_USER_CHARS: cap on the combined user-authored text forwarded.
 */
const MAX_HISTORY_TURNS = 6;
const MAX_MESSAGE_CHARS = 600;
const MAX_TOTAL_USER_CHARS = 3000;

/**
 * Copilot chat endpoint. Accepts { messages: [{role, content}, ...] } and answers the
 * latest user message grounded in live simulation + forecast + optimization data.
 * Engine: Claude (when configured, in-scope, and within limits) with a deterministic
 * rule-based fallback. Always responds { reply, mode: "claude" | "rules" }.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Type-validate every message before any processing; malformed entries are
  // dropped so a bad payload can never reach Anthropic.
  const raw = (body as { messages?: unknown })?.messages;
  const valid: CopilotChatMessage[] = Array.isArray(raw)
    ? raw
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            !!m &&
            typeof m === "object" &&
            ((m as { role?: unknown }).role === "user" ||
              (m as { role?: unknown }).role === "assistant") &&
            typeof (m as { content?: unknown }).content === "string"
        )
        .map((m) => ({ role: m.role, content: m.content }))
    : [];

  // The latest user message is the actual question. Flag it as oversized BEFORE
  // truncation so an unreasonable prompt is answered by the rule engine rather
  // than sent (truncated) to Claude.
  const lastUserRaw = [...valid].reverse().find((m) => m.role === "user");
  if (!lastUserRaw?.content.trim()) {
    return NextResponse.json({ error: "No user message provided" }, { status: 400 });
  }
  const forceRules = lastUserRaw.content.length > MAX_MESSAGE_CHARS;

  // 1. Retain only the most recent turns (bounds unlimited history re-sending).
  let history = valid.slice(-MAX_HISTORY_TURNS * 2);

  // 2. Cap each message's content length (user-controlled text is truncated).
  history = history.map((m) => ({
    role: m.role,
    content: m.content.length > MAX_MESSAGE_CHARS ? m.content.slice(0, MAX_MESSAGE_CHARS) : m.content,
  }));

  // 3. Cap total user-authored characters forwarded to the AI, dropping the
  //    OLDEST user turns first so the latest question is always preserved.
  let userChars = history
    .filter((m) => m.role === "user")
    .reduce((sum, m) => sum + m.content.length, 0);
  if (userChars > MAX_TOTAL_USER_CHARS) {
    const trimmed: CopilotChatMessage[] = [];
    // Walk newest -> oldest, keeping messages until the user-char budget is hit.
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role === "user") {
        if (userChars > MAX_TOTAL_USER_CHARS) {
          userChars -= m.content.length;
          continue; // drop this old user turn
        }
      }
      trimmed.unshift(m);
    }
    history = trimmed;
  }

  const question = history.slice().reverse().find((m) => m.role === "user")?.content ?? lastUserRaw.content.slice(0, MAX_MESSAGE_CHARS);
  const ip = resolveClientIp(request.headers);

  // TEMPORARY outermost diagnostic: one unconditional line per request so Vercel
  // logs confirm the function ran and show why Claude may be skipped. Logs ONLY
  // presence booleans — never keys, tokens, env values, prompts, user text,
  // IPs, or headers. Remove once the Production Claude path is confirmed.
  console.log(
    `[copilot-diag] hasAnthropicKey=${Boolean(process.env.ANTHROPIC_API_KEY)}` +
      ` hasRedisUrl=${Boolean(process.env.UPSTASH_REDIS_REST_URL)}` +
      ` hasRedisToken=${Boolean(process.env.UPSTASH_REDIS_REST_TOKEN)}` +
      ` forceRules=${forceRules}`
  );

  const { reply, mode } = await answerQuestion(question, history, { ip, forceRules });
  return NextResponse.json({ reply, mode });
}
