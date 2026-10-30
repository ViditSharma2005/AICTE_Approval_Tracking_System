import { db } from "@/lib/db";
import { activeCaseCount, DEFAULT_MAX_ACTIVE_CASES } from "@/lib/assignment";

/**
 * Feature 5 — "7/10 active cases".
 * Shows an officer how much of their cap they are carrying, and warns the
 * regional office when someone is full.
 */
export async function CapacityBar({
  userId,
  role,
  label = "My workload",
}: {
  userId: string;
  role: string;
  label?: string;
}) {
  const me = await db.user.findUnique({
    where: { id: userId },
    select: { maxActiveCases: true },
  });
  const cap = me?.maxActiveCases || DEFAULT_MAX_ACTIVE_CASES;
  const active = await activeCaseCount(userId, role);
  const pct = Math.min(100, Math.round((active / Math.max(cap, 1)) * 100));
  const tone = active >= cap ? "red" : pct >= 80 ? "amber" : "green";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="text-sm font-semibold text-ink tnum">
          {active}/{cap} <span className="text-[11px] font-normal text-ink-faint">active cases</span>
        </p>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        {active >= cap
          ? "At capacity — new cases wait in the unassigned queue until you clear work or your cap is raised."
          : `${cap - active} more case(s) can be auto-assigned to you.`}
      </p>
    </div>
  );
}
