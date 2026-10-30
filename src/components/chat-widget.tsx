"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Send, Sparkles, X } from "lucide-react";
import { AiBadge } from "./ai-badge";

// ---------------------------------------------------------------------------
// Context: pages tell the assistant what the user is looking at
// ---------------------------------------------------------------------------

export type ChatContextValue = {
  entityType?: string;
  entityId?: string;
  label?: string;
  detail?: string;
};

/**
 * A page (server component) renders <ChatContextSetter> to tell the assistant
 * what is on screen; the widget in the layout picks it up through this tiny
 * external store, so there is one assistant for the whole app.
 */
let current: ChatContextValue | null = null;
const listeners = new Set<(v: ChatContextValue | null) => void>();

export function setChatContext(value: ChatContextValue | null) {
  current = value;
  listeners.forEach((l) => l(value));
}

export function useChatContext(): ChatContextValue | null {
  const [value, setValue] = useState<ChatContextValue | null>(current);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

/** Drop this into any page to give the assistant the current subject. */
export function ChatContextSetter({ value }: { value: ChatContextValue }) {
  useEffect(() => {
    setChatContext(value);
    return () => setChatContext(null);
  }, [value]);
  return null;
}

type Msg = { role: "user" | "assistant"; content: string };

export function ChatWidget({ suggestions }: { suggestions: string[] }) {
  const ctx = useChatContext();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, open]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const next: Msg[] = [...messages, { role: "user", content: question }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          context: ctx,
        }),
      });
      if (!res.ok || !res.body) {
        setMessages([...next, { role: "assistant", content: "I don't have that information right now — the assistant could not be reached." }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc }]);
      }
    } catch {
      setMessages([...next, { role: "assistant", content: "I don't have that information right now — the assistant could not be reached." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* launcher */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-navy text-white shadow-pop transition-transform hover:scale-105 no-print"
        aria-label="Open the portal assistant"
        title="Ask the portal assistant"
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end no-print">
          <div className="absolute inset-0 bg-navy/20" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-pop">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                  Portal assistant
                  <AiBadge />
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  Read-only · answers only from live portal data · never approves or rejects
                </p>
                {ctx?.label ? (
                  <p className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-ink-soft">
                    Viewing {ctx.entityType} <span className="font-semibold">{ctx.label}</span>
                    {ctx.detail ? ` — ${ctx.detail}` : ""}
                  </p>
                ) : null}
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.length === 0 ? (
                <div>
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
                    Ask about an application, your queue, expiring documents, undertakings, a trust score or the audit
                    trail. I answer only from what the portal actually holds — and I never take a decision on your behalf.
                  </p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Try</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestions.map((s) => (
                      <button key={s} type="button" className="chip hover:bg-slate-100" onClick={() => void send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                      m.role === "user" ? "bg-navy text-white" : "whitespace-pre-wrap bg-slate-50 text-ink"
                    }`}
                  >
                    {m.content || (busy && i === messages.length - 1 ? "…" : "")}
                  </div>
                </div>
              ))}
            </div>

            <form
              className="flex items-end gap-2 border-t border-slate-200 px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder="Ask about a case, deadline or document…"
                className="input max-h-24 min-h-[38px] flex-1 resize-none py-2"
              />
              <button type="submit" className="btn-primary btn-sm" disabled={busy || !input.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </form>

            <p className="flex items-center gap-1.5 border-t border-slate-100 px-5 py-2 text-[10px] text-ink-faint">
              <Sparkles className="h-3 w-3" /> Advisory only — official interpretation rests with AICTE.
            </p>
          </aside>
        </div>
      ) : null}
    </>
  );
}
