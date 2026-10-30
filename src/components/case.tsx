import { APP_STATUS, DOC_STATUS, EVC_STATUS, STAGES, UNDERTAKING_STATUS, type StageKey } from "@/lib/constants";
import { cn } from "./ui";
import { Pill, type Tone } from "./ui";
import { deadlineLabel, daysUntil } from "@/lib/time";
import { parseStringArray } from "@/lib/json";
import { effectiveStage } from "@/lib/workflow";
import { FileText, CheckCircle2, Circle, CircleDot, AlertTriangle } from "lucide-react";

// ---------------------------------------------------------------------------
// Status pills
// ---------------------------------------------------------------------------

export function StatusPill({ status }: { status: string }) {
  const meta = (APP_STATUS as Record<string, { label: string; tone: Tone }>)[status];
  return <Pill tone={meta?.tone ?? "slate"}>{meta?.label ?? status}</Pill>;
}

export function UndertakingStatusPill({ status }: { status: string }) {
  const meta = (UNDERTAKING_STATUS as Record<string, { label: string; tone: Tone }>)[status];
  return <Pill tone={meta?.tone ?? "slate"}>{meta?.label ?? status}</Pill>;
}

export function DocStatusPill({ status }: { status: string }) {
  const meta = (DOC_STATUS as Record<string, { label: string; tone: Tone }>)[status];
  return <Pill tone={meta?.tone ?? "slate"}>{meta?.label ?? status}</Pill>;
}

export function EvcStatusPill({ status }: { status: string }) {
  const meta = (EVC_STATUS as Record<string, { label: string; tone: Tone }>)[status];
  return <Pill tone={meta?.tone ?? "slate"}>{meta?.label ?? status}</Pill>;
}

// ---------------------------------------------------------------------------
// SLA countdown chip
// ---------------------------------------------------------------------------

export function SlaChip({ dueAt, className }: { dueAt: Date | string | null | undefined; className?: string }) {
  if (!dueAt) return <Pill tone="slate">No SLA</Pill>;
  const date = new Date(dueAt);
  const days = daysUntil(date);
  const tone: Tone = days <= 0 ? "red" : days <= 3 ? "orange" : days <= 7 ? "amber" : "green";
  return (
    <Pill tone={tone} className={cn("tnum", className)}>
      {days <= 0 ? <AlertTriangle className="h-3 w-3" /> : null}
      {deadlineLabel(date)}
    </Pill>
  );
}

// ---------------------------------------------------------------------------
// Explainable priority score
// ---------------------------------------------------------------------------

export function PriorityBadge({
  score,
  band,
  reasons,
}: {
  score: number;
  band: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasons: { label: string; points: number }[];
}) {
  const tone: Tone = band === "CRITICAL" ? "red" : band === "HIGH" ? "orange" : band === "MEDIUM" ? "amber" : "green";
  return (
    <details className="group relative inline-block text-left">
      <summary className="cursor-pointer list-none">
        <Pill tone={tone} className="tnum">
          Priority {score} · {band}
        </Pill>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-pop">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          How this score is calculated
        </p>
        {reasons.length === 0 ? (
          <p className="text-xs text-ink-soft">Nothing overdue — this case is inside every SLA.</p>
        ) : (
          <ul className="space-y-1">
            {reasons.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3 text-xs text-ink-soft">
                <span>{r.label}</span>
                <span className="font-mono font-semibold text-ink">+{r.points}</span>
              </li>
            ))}
            <li className="mt-1 flex items-center justify-between gap-3 border-t border-slate-100 pt-1 text-xs font-semibold text-ink">
              <span>Total</span>
              <span className="font-mono">{score}</span>
            </li>
          </ul>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Route stepper
// ---------------------------------------------------------------------------

export function StageStepper({
  route,
  currentStage,
  status,
  compact = false,
}: {
  route: string[];
  currentStage: string;
  status: string;
  compact?: boolean;
}) {
  const terminal = status === "APPROVED" || status === "CONDITIONALLY_APPROVED" || status === "REJECTED";
  const currentIdx = route.indexOf(effectiveStage(currentStage as never));
  const steps = route.filter((s) => s !== "COMPLETED");

  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex min-w-max items-center gap-1">
        {steps.map((stage, i) => {
          const meta = (STAGES as Record<string, { short: string; label: string }>)[stage] ?? {
            short: stage,
            label: stage,
          };
          const done = terminal || i < currentIdx;
          const active = !terminal && i === currentIdx;

          return (
            <li key={stage + i} className="flex items-center">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold",
                  done && "bg-emerald-50 text-emerald-700",
                  active && "bg-indigo-600 text-white shadow-sm",
                  !done && !active && "bg-slate-100 text-ink-faint",
                )}
                title={meta.label}
              >
                {done ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : active ? (
                  <CircleDot className="h-3.5 w-3.5" />
                ) : (
                  <Circle className="h-3.5 w-3.5" />
                )}
                {meta.short}
                {!compact && active ? <span className="font-normal opacity-80">· current</span> : null}
              </div>
              {i < steps.length - 1 ? <span className={cn("mx-1 h-px w-6", done ? "bg-emerald-300" : "bg-slate-200")} /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case timeline
// ---------------------------------------------------------------------------

export function CaseTimeline({
  items,
}: {
  items: {
    id: string;
    action: string;
    fromStage: string | null;
    toStage: string;
    actorName: string;
    actorRole: string;
    reason: string | null;
    createdAt: Date;
  }[];
}) {
  if (!items.length) return <p className="text-sm text-ink-faint">No movement recorded yet.</p>;

  return (
    <ol className="relative space-y-5 border-l border-slate-200 pl-6">
      {items.map((t) => {
        const to = (STAGES as Record<string, { label: string }>)[t.toStage]?.label ?? t.toStage;
        const from = t.fromStage ? ((STAGES as Record<string, { label: string }>)[t.fromStage]?.label ?? t.fromStage) : null;
        const adverse = ["REVERT", "REJECT"].includes(t.action);

        return (
          <li key={t.id} className="relative">
            <span
              className={cn(
                "absolute -left-[31px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white",
                adverse ? "bg-red-500" : t.actorName === "SYSTEM" ? "bg-amber-500" : "bg-indigo-500",
              )}
            />
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-semibold text-ink">{to}</p>
              <span className="text-xs text-ink-faint">
                {new Date(t.createdAt).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">
              {from ? `${from} → ${to}` : `Created at ${to}`} · <span className="font-medium">{t.actorName}</span> (
              {t.actorRole.replace(/_/g, " ").toLowerCase()}) · {t.action.replace(/_/g, " ").toLowerCase()}
            </p>
            {t.reason ? (
              <p
                className={cn(
                  "mt-2 rounded-lg border px-3 py-2 text-xs",
                  adverse ? "border-red-100 bg-red-50/70 text-red-800" : "border-slate-200 bg-slate-50 text-ink-soft",
                )}
              >
                <span className="font-semibold">Reason recorded: </span>
                {t.reason}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function DocChip({ fileName }: { fileName: string | null }) {
  if (!fileName) return <span className="text-xs text-ink-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
      <FileText className="h-3.5 w-3.5 text-slate-400" />
      <span className="font-mono">{fileName}</span>
    </span>
  );
}

export function Members({ members }: { members: string }) {
  const list = parseStringArray(members);
  if (!list.length) return <span className="text-xs text-ink-faint">Not yet constituted</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((m) => (
        <span key={m} className="chip">
          {m}
        </span>
      ))}
    </div>
  );
}

export function stageLabelOf(stage: string): string {
  return (STAGES as Record<string, { label: string }>)[stage]?.label ?? stage;
}

export function stageKeyList(route: string): StageKey[] {
  return parseStringArray(route) as StageKey[];
}
