"use client";

import { useState } from "react";
import { FileText, Loader2, Send, X } from "lucide-react";
import { AiBadge } from "./ai-badge";

type Draft = { type: string; template: string; subject: string; html: string; refNumber: string };

/**
 * Feature 8 — draft → review → mark as sent.
 * The letter is generated from live case data, shown in full for review, and
 * only becomes an issued letter when the officer clicks "Mark as Sent".
 */
export function LetterButton({
  applicationId,
  type,
  label,
  onSent,
}: {
  applicationId: string;
  type: string;
  label: string;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function openDraft() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch(`/api/letters/preview?applicationId=${applicationId}&type=${type}`);
      if (!res.ok) throw new Error("The draft could not be generated.");
      setDraft((await res.json()) as Draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The draft could not be generated.");
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/letters/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, type }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Could not record the letter.");
      setSent(true);
      onSent?.();
      setTimeout(() => setOpen(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the letter.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => void openDraft()}>
        <FileText className="h-3.5 w-3.5" />
        {label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/40 p-4 no-print" onClick={() => setOpen(false)}>
          <div className="my-6 w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                  {label}
                  <AiBadge label="Auto-drafted" tone="amber" />
                </p>
                <p className="mt-0.5 text-[12px] text-ink-faint">
                  Drafted from live case data · {draft?.template ?? ""} · review before issuing
                </p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto bg-slate-50 px-5 py-4">
              {loading ? (
                <p className="flex items-center gap-2 py-8 text-sm text-ink-soft">
                  <Loader2 className="h-4 w-4 animate-spin" /> Drafting from the case file…
                </p>
              ) : error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
              ) : draft ? (
                <div className="rounded-lg bg-white p-6 shadow-soft" dangerouslySetInnerHTML={{ __html: draft.html }} />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <p className="max-w-md text-[11px] leading-relaxed text-ink-faint">
                This draft is advisory output of the portal. It is not sent to the institution until you mark it as sent,
                and marking it records your name in the audit trail.
              </p>
              <div className="flex items-center gap-2">
                {sent ? <span className="text-xs font-semibold text-emerald-700">Recorded as sent</span> : null}
                <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
                  Discard draft
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={() => void send()} disabled={!draft || saving || sent}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {saving ? "Recording…" : "Mark as Sent"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
