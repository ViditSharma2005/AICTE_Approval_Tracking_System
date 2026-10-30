"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, X, Loader2 } from "lucide-react";

type Breakdown = {
  score: number;
  status: string;
  institution: { id: string; name: string; city: string; state: string };
  byType: { event: string; label: string; count: number; total: number }[];
  events: { id: string; event: string; label: string; delta: number; note: string | null; createdAt: string; applicationId: string | null }[];
};

const TONE_CLASS = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
} as const;

const BAR_COLOR = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" } as const;

function toneFor(score: number): keyof typeof TONE_CLASS {
  return score >= 80 ? "green" : score >= 50 ? "amber" : "red";
}

/**
 * Trust badge — shows next to an institution's name everywhere.
 * Clicking opens the full, event-sourced explanation.
 */
export function TrustBadge({
  institutionId,
  score,
  name,
  size = "sm",
}: {
  institutionId: string;
  score: number;
  name?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const tone = toneFor(score);
  const cache = useRef<Record<string, Breakdown>>({});

  async function openPanel() {
    setOpen(true);
    if (cache.current[institutionId]) {
      setData(cache.current[institutionId]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/trust?institutionId=${institutionId}`);
      if (res.ok) {
        const json = (await res.json()) as Breakdown;
        cache.current[institutionId] = json;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void openPanel();
        }}
        title={`Compliance trust score ${score}/100 — click for the full breakdown`}
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ring-1 ring-inset transition-colors hover:brightness-95 no-print ${TONE_CLASS[tone]} ${
          size === "sm" ? "text-[10px]" : "text-[11px]"
        }`}
      >
        <ShieldCheck className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
        <span className="tnum">{score}</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4 no-print"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  Compliance trust score
                </p>
                <p className="text-sm font-semibold text-ink">{name ?? data?.institution.name ?? "Institution"}</p>
                {data ? (
                  <p className="text-[11px] text-ink-faint">
                    {data.institution.city}, {data.institution.state} · {data.status.replace(/_/g, " ")}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className={`text-2xl font-bold tnum ${tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-red-600"}`}>
                    {data?.score ?? score}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-ink-faint">of 100</p>
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="px-5 pt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${BAR_COLOR[toneFor(data?.score ?? score)]}`} style={{ width: `${data?.score ?? score}%` }} />
              </div>
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                Starting score 100. Every event below is recorded against this institution. The score is advisory
                only — no suspension, penalty or rejection is ever triggered by it automatically.
              </p>
            </div>

            <div className="max-h-[45vh] overflow-y-auto px-5 py-4">
              {loading ? (
                <p className="flex items-center gap-2 py-6 text-sm text-ink-soft">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading event history…
                </p>
              ) : data ? (
                <>
                  {data.byType.length ? (
                    <div className="mb-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        Contributions by event type
                      </p>
                      <ul className="space-y-1.5">
                        {data.byType.map((t) => (
                          <li key={t.event} className="flex items-center gap-3 text-xs">
                            <span className="min-w-0 flex-1 truncate text-ink-soft">{t.label}</span>
                            <span className="chip tnum">×{t.count}</span>
                            <span className={`w-12 text-right font-mono font-semibold tnum ${t.total < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {t.total > 0 ? `+${t.total}` : t.total}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Event history</p>
                  {data.events.length ? (
                    <ul className="space-y-2">
                      {data.events.map((e) => (
                        <li key={e.id} className="rounded-lg border border-slate-200 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-xs font-semibold text-ink">{e.label}</p>
                            <span className={`font-mono text-xs font-bold tnum ${e.delta < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {e.delta > 0 ? `+${e.delta}` : e.delta}
                            </span>
                          </div>
                          {e.note ? <p className="mt-0.5 text-[11px] text-ink-soft">{e.note}</p> : null}
                          <p className="mt-1 text-[10px] text-ink-faint">
                            {new Date(e.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-4 text-center text-sm text-ink-faint">
                      No events recorded — this institution is at the starting score of 100.
                    </p>
                  )}
                </>
              ) : (
                <p className="py-6 text-center text-sm text-ink-faint">Breakdown unavailable.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
