"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { PlusCircle, Trash2, Printer, Loader2 } from "lucide-react";
import { cn } from "./ui";

// ---------------------------------------------------------------------------
// Submit button with automatic pending state
// ---------------------------------------------------------------------------

export function SubmitButton({
  children,
  className = "btn-primary btn-sm",
  pendingLabel,
  confirm,
  disabled,
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  confirm?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      className={cn(className, "no-print")}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Demo ticker — keeps the deadline engine alive on screen during demos
// ---------------------------------------------------------------------------

export function DemoTicker({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [ticking, setTicking] = useState(true);

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(async () => {
      try {
        await fetch("/api/tick", { method: "POST" });
        router.refresh();
      } catch {
        /* offline — ignore */
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [ticking, intervalMs, router]);

  return (
    <button
      type="button"
      onClick={() => setTicking((v) => !v)}
      title="The deadline engine runs on every page load. This ticker additionally polls it every few seconds so you can watch reminders and escalations fire live."
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition-colors no-print",
        ticking ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ticking ? "animate-pulse bg-emerald-500" : "bg-slate-400")} />
      {ticking ? "Live engine" : "Engine paused"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Repeatable undertaking rows (conditional approval / deficiency)
// ---------------------------------------------------------------------------

export function UndertakingRows({
  defaultRows = [{ title: "", description: "", days: "30" }],
  daysOptions = [15, 30, 60, 90],
  label = "Undertakings / conditions of approval",
}: {
  defaultRows?: { title: string; description: string; days: string }[];
  daysOptions?: number[];
  label?: string;
}) {
  const [rows, setRows] = useState(defaultRows);

  const update = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="label mb-0">{label}</span>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setRows((prev) => [...prev, { title: "", description: "", days: "30" }])}
        >
          <PlusCircle className="h-3.5 w-3.5" /> Add row
        </button>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-start gap-3">
            <span className="mt-2 w-5 shrink-0 text-xs font-bold text-ink-faint">{i + 1}.</span>
            <div className="grid flex-1 gap-3 sm:grid-cols-[2fr,1fr]">
              <div>
                <label className="label">Title</label>
                <input
                  name="ut_title"
                  className="input"
                  placeholder="e.g. Submit renewed lease deed"
                  value={row.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Compliance window</label>
                <select
                  name="ut_days"
                  className="select"
                  value={row.days}
                  onChange={(e) => update(i, { days: e.target.value })}
                >
                  {daysOptions.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm mt-6 text-red-600 hover:bg-red-50"
              onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}
              aria-label="Remove row"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 pl-8">
            <label className="label">Details / what must be uploaded</label>
            <textarea
              name="ut_desc"
              className="textarea min-h-[64px]"
              placeholder="Describe exactly what the institution must do or upload."
              value={row.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
          </div>
        </div>
      ))}

      <p className="hint">
        Each row becomes a tracked undertaking with its own deadline, reminders (7 / 2 / 0 days) and escalation
        ladder. Nothing here is decided by a machine — the officer decides, the system tracks.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary btn-sm no-print" onClick={() => window.print()}>
      <Printer className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Auto-refresh (used on dashboards in demo mode)
// ---------------------------------------------------------------------------

export function AutoRefresh({ intervalMs = 15000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, router]);
  return null;
}
