"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Users, X, AlertTriangle, Check } from "lucide-react";

type Scored = {
  id: string;
  name: string;
  designation: string;
  designationLabel: string;
  city: string;
  state: string;
  score: number;
  distanceKm: number | null;
  visitsThisMonth: number;
  available: boolean;
  reasons: string[];
};

type Slot = {
  key: string;
  role: string;
  label: string;
  note?: string;
  selected: Scored | null;
  alternates: Scored[];
};

type Proposal = {
  lowTrust: boolean;
  trustScore: number;
  slots: Slot[];
  total: number;
  warning?: string;
};

type Payload = {
  visitId: string;
  refNumber: string;
  institution: { name: string; city: string; state: string; trustScore: number };
  proposal: Proposal;
};

/**
 * Feature 4 — "Auto-Allocate Panel".
 * Fetches the ranked proposal, shows why each expert was chosen, lets the
 * coordinator swap any member, and only saves when they confirm.
 */
export function AutoAllocateButton({ visitId }: { visitId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function load() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch(`/api/evc/panel?visitId=${visitId}`);
      if (!res.ok) throw new Error("Could not build a proposal for this visit.");
      const json = (await res.json()) as Payload;
      setData(json);
      const initial: Record<string, string> = {};
      for (const s of json.proposal.slots) if (s.selected) initial[s.key] = s.selected.id;
      setChoices(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
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

  async function confirm() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const selections = data.proposal.slots.map((slot) => {
        const expertId = choices[slot.key] ?? slot.selected?.id ?? "";
        const expert = [slot.selected, ...slot.alternates].find((e) => e?.id === expertId) ?? null;
        return { slot: slot.key, expertId, score: expert?.score, reasons: expert?.reasons };
      });
      if (selections.some((s) => !s.expertId)) {
        setError("Every slot needs an expert. Widen the window or empanel more experts.");
        setSaving(false);
        return;
      }
      const res = await fetch(`/api/evc/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId, selections }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Could not save the panel.");
      setDone(true);
      setTimeout(() => {
        setOpen(false);
        window.location.reload();
      }, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the panel.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => void load()}>
        <Sparkles className="h-3.5 w-3.5" />
        Auto-Allocate Panel
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/40 p-4 no-print" onClick={() => setOpen(false)}>
          <div className="my-8 w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                  <Users className="h-4 w-4" /> Auto-allocate EVC panel
                </p>
                <p className="mt-0.5 text-[12px] text-ink-faint">
                  {data ? `${data.refNumber} · ${data.institution.name}, ${data.institution.city}` : "Building the proposal…"}
                </p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              {loading ? (
                <p className="flex items-center gap-2 py-8 text-sm text-ink-soft">
                  <Loader2 className="h-4 w-4 animate-spin" /> Scoring the expert pool…
                </p>
              ) : error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>
              ) : data ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-ink-soft">
                    <span className="chip tnum">Trust score {data.proposal.trustScore}</span>
                    {data.proposal.lowTrust ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700 ring-1 ring-inset ring-red-200">
                        <AlertTriangle className="h-3 w-3" /> High scrutiny — chair must be professor level
                      </span>
                    ) : null}
                    <span className="tnum">Proposed panel score {data.proposal.total}</span>
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">
                      <Sparkles className="h-2.5 w-2.5" /> AI-assisted · advisory
                    </span>
                  </div>

                  {data.proposal.warning ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {data.proposal.warning}
                    </p>
                  ) : null}

                  {data.proposal.slots.map((slot) => {
                    const options = [slot.selected, ...slot.alternates].filter(Boolean) as Scored[];
                    const chosenId = choices[slot.key] ?? slot.selected?.id ?? "";
                    const chosen = options.find((o) => o.id === chosenId) ?? null;
                    return (
                      <div key={slot.key} className="rounded-xl border border-slate-200 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13px] font-semibold text-ink">
                            {slot.label}
                            {slot.role === "CHAIR" ? <span className="ml-2 chip">Chair</span> : null}
                          </p>
                          {slot.note ? <p className="text-[11px] text-ink-faint">{slot.note}</p> : null}
                        </div>

                        {options.length ? (
                          <>
                            <select
                              className="select"
                              value={chosenId}
                              onChange={(e) => setChoices((c) => ({ ...c, [slot.key]: e.target.value }))}
                            >
                              {options.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name} — {o.designationLabel}, {o.city} ({o.score})
                                </option>
                              ))}
                            </select>

                            {chosen ? (
                              <div className="mt-2">
                                <p className="text-[11px] text-ink-faint">
                                  {chosen.designationLabel} · {chosen.city}, {chosen.state}
                                </p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {chosen.reasons.map((r) => (
                                    <span
                                      key={r}
                                      className={`chip tnum ${
                                        r.includes("Conflict") || r.includes("Same state") || r.includes("busy")
                                          ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
                                          : ""
                                      }`}
                                    >
                                      {r}
                                    </span>
                                  ))}
                                  <span className="chip tnum bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200">
                                    score {chosen.score}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-[12px] text-ink-faint">No eligible, conflict-free expert available.</p>
                        )}
                      </div>
                    );
                  })}

                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    The allocation engine ranks the empanelled pool on proximity, availability, conflict of interest and
                    current load. It never allocates on its own — you confirm or swap every member here.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              {done ? (
                <p className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
                  <Check className="h-4 w-4" /> Panel saved and experts notified
                </p>
              ) : null}
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={!data || saving || done}
                onClick={() => void confirm()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : "Confirm panel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
