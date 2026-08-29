"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Which engine answered: "claude" = AI-powered, "rules" = deterministic fallback. */
  mode?: "claude" | "rules";
}

const SUGGESTED_PROMPTS = [
  "What did the VPP optimize today?",
  "Why did the battery discharge at 6pm?",
  "Why was EV charging delayed?",
  "Why is demand high today?",
  "Which asset is underperforming?",
  "What is the biggest saving today?",
];

const WELCOME: ChatMessage = {
  role: "assistant",
  content:
    "I'm the WeaveGrid operations copilot. I have live visibility into your fleet's generation, demand, battery state, forecasts, and AI recommendations. Ask me anything about today's operations — or try one of the suggestions below.",
};

export function CopilotChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { reply, mode } = (await res.json()) as { reply: string; mode?: "claude" | "rules" };
      setMessages((m) => [...m, { role: "assistant", content: reply, mode }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Something went wrong reaching the copilot service. Please try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-6">
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {busy && <TypingIndicator />}
      </div>

      <div className="border-t border-border bg-surface/40 p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void send(p)}
              disabled={busy}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about demand, forecasts, assets, risks, savings..."
            className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-accent-green-dim/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[75%] rounded-2xl rounded-br-sm bg-brand text-white px-4 py-2.5 text-sm"
            : "card-shadow max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-2.5 text-sm leading-relaxed text-foreground"
        }
      >
        {!isUser && (
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand">
            <Sparkles className="h-3.5 w-3.5 text-accent-cyan" strokeWidth={2.5} /> Copilot
            {message.mode === "claude" && (
              <span className="rounded-full border border-accent-cyan/40 bg-accent-cyan/10 px-1.5 py-px text-[9px] font-medium normal-case tracking-normal text-brand">
                AI-powered · Claude
              </span>
            )}
            {message.mode === "rules" && (
              <span className="rounded-full border border-border bg-surface-raised/60 px-1.5 py-px text-[9px] font-medium normal-case tracking-normal text-muted">
                fallback · rule engine
              </span>
            )}
          </p>
        )}
        {message.content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-border bg-surface px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-green"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
