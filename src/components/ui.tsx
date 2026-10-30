import Link from "next/link";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | false | null | undefined)[]) {
  return twMerge(clsx(inputs));
}

export type Tone = "green" | "amber" | "red" | "blue" | "indigo" | "violet" | "slate" | "orange";

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={cn("card", padded && "card-pad", className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h3 className="card-title">{title}</h3>
        {subtitle ? <p className="card-sub">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0 no-print">{action}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{children}</h2>
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pill / badge
// ---------------------------------------------------------------------------

export function Pill({
  tone = "slate",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn(`pill-${tone}`, className)}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "indigo",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "indigo" | "green" | "amber" | "red" | "navy" | "violet";
  href?: string;
}) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    navy: "bg-navy/10 text-navy",
    violet: "bg-violet-50 text-violet-600",
  };

  const body = (
    <div className="card card-pad flex h-full items-start gap-4 transition-shadow hover:shadow-pop">
      {icon ? (
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-ink tnum">{value}</p>
        {hint ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="table-wrap">
      <table className={cn("w-full min-w-[640px] border-collapse", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-slate-200 bg-slate-50/80">{children}</thead>;
}
export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("th", className)}>{children}</th>;
}
export function TD({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("td", className)}>{children}</td>;
}
export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("border-b border-slate-100 last:border-0 row-hover", className)}>{children}</tr>;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-slate-400">{icon}</div> : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint ? <p className="mt-1 max-w-md text-xs text-ink-faint">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function KeyValue({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode; mono?: boolean }[];
  columns?: 1 | 2 | 3;
}) {
  const cols = columns === 1 ? "grid-cols-1" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", cols)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{it.label}</dt>
          <dd className={cn("mt-0.5 text-sm text-ink", it.mono && "font-mono text-[13px]")}>{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({
  value,
  max,
  tone = "indigo",
}: {
  value: number;
  max: number;
  tone?: "indigo" | "green" | "amber" | "red";
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const map = {
    indigo: "bg-indigo-500",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full transition-all", map[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Banner({
  tone = "indigo",
  title,
  children,
}: {
  tone?: "indigo" | "amber" | "red" | "green";
  title?: string;
  children?: ReactNode;
}) {
  const map = {
    indigo: "border-indigo-200 bg-indigo-50/70 text-indigo-900",
    amber: "border-amber-200 bg-amber-50/70 text-amber-900",
    red: "border-red-200 bg-red-50/70 text-red-900",
    green: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm", map[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className="mt-0.5 text-[13px] opacity-90">{children}</div> : null}
    </div>
  );
}

export function Avatar({ name, role }: { name: string; role?: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white">
        {initials}
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
        {role ? <p className="truncate text-[11px] text-ink-faint">{role}</p> : null}
      </div>
    </div>
  );
}
