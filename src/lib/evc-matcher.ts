/**
 * Feature 4 — automatic EVC panel allocation.
 *
 * The engine proposes; the coordinator disposes. Nothing here writes to the
 * database — it returns a ranked proposal plus alternates, and a human confirms
 * the panel (or swaps a member) before anything is saved.
 */

import { db } from "./db";
import { parseStringArray } from "./json";

export type ExpertDesignation = "PROFESSOR_LEVEL" | "ASSOCIATE_PROF" | "ARCHITECT_CIVIL";

export const DESIGNATION_LABELS: Record<string, string> = {
  PROFESSOR_LEVEL: "Professor level",
  ASSOCIATE_PROF: "Associate Professor",
  ARCHITECT_CIVIL: "Architect / Civil engineer",
};

export type PanelSlot = {
  role: "CHAIR" | "MEMBER";
  key: "CHAIR" | "MEMBER_ACADEMIC" | "MEMBER_TECHNICAL";
  label: string;
  /** Chair is normally open to professor-level and associate professors; a
   *  low-trust institution narrows it to professor level only. */
  allowed: ExpertDesignation[];
};

export const PANEL_SLOTS: PanelSlot[] = [
  { role: "CHAIR", key: "CHAIR", label: "Chairperson", allowed: ["PROFESSOR_LEVEL", "ASSOCIATE_PROF"] },
  { role: "MEMBER", key: "MEMBER_ACADEMIC", label: "Academic member", allowed: ["ASSOCIATE_PROF"] },
  { role: "MEMBER", key: "MEMBER_TECHNICAL", label: "Technical member", allowed: ["ARCHITECT_CIVIL"] },
];

/** Below this score the case is treated as high-scrutiny: the chair must be professor level. */
export const LOW_TRUST_THRESHOLD = 50;

export type ScoredExpert = {
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
  userId: string | null;
};

// ---------------------------------------------------------------------------
// geography
// ---------------------------------------------------------------------------

export function haversineKm(
  a: { latitude: number | null; longitude: number | null },
  b: { latitude: number | null; longitude: number | null },
): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

type BusyRange = { from: string; to: string };

function isBusy(busyRangesJson: string, window: { start: Date; end: Date }): boolean {
  let ranges: BusyRange[] = [];
  try {
    ranges = JSON.parse(busyRangesJson || "[]") as BusyRange[];
  } catch {
    ranges = [];
  }
  return ranges.some((r) => {
    const from = new Date(r.from).getTime();
    const to = new Date(r.to).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return false;
    return from <= window.end.getTime() && to >= window.start.getTime();
  });
}

/** How many visits this expert is already carrying in the current month. */
export async function visitsThisMonth(expertId: string, reference = new Date()): Promise<number> {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0, 23, 59, 59);
  const visits = await db.evcVisit.findMany({
    where: { allocatedAt: { gte: start, lte: end } },
    select: { experts: true },
  });
  return visits.filter((v) => {
    try {
      const panel = JSON.parse(v.experts || "[]") as { id?: string }[];
      return Array.isArray(panel) && panel.some((p) => p?.id === expertId);
    } catch {
      return false;
    }
  }).length;
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

export type ScoreContext = {
  college: { latitude: number | null; longitude: number | null; state: string };
  window: { start: Date; end: Date };
  visitsThisMonth: number;
};

/**
 * +40 available in the visit window
 * +30/20/10 for under 100 / 300 / 500 km
 * −100 if the expert's own state is the college's state or is on their conflict list
 * +10 if they are still under their monthly cap
 */
export function scoreExpert(
  expert: {
    id: string;
    name: string;
    designation: string;
    city: string;
    state: string;
    latitude: number | null;
    longitude: number | null;
    busyRanges: string;
    conflictStates: string;
    maxPerMonth: number;
    userId: string | null;
  },
  ctx: ScoreContext,
): ScoredExpert {
  const reasons: string[] = [];
  let score = 0;

  const available = !isBusy(expert.busyRanges, ctx.window);
  if (available) {
    score += 40;
    reasons.push("Available in window");
  } else {
    reasons.push("Marked busy in window");
  }

  const distanceKm = haversineKm(expert, ctx.college);
  if (distanceKm !== null) {
    if (distanceKm < 100) {
      score += 30;
      reasons.push(`${distanceKm}km away`);
    } else if (distanceKm < 300) {
      score += 20;
      reasons.push(`${distanceKm}km away`);
    } else if (distanceKm < 500) {
      score += 10;
      reasons.push(`${distanceKm}km away`);
    } else {
      reasons.push(`${distanceKm}km away`);
    }
  }

  const conflicts = parseStringArray(expert.conflictStates);
  const conflicted = conflicts.includes(ctx.college.state) || expert.state === ctx.college.state;
  if (conflicted) {
    score -= 100;
    reasons.push(expert.state === ctx.college.state ? "Same state as college" : "Conflict state");
  } else {
    reasons.push("No conflict");
  }

  if (ctx.visitsThisMonth < expert.maxPerMonth) {
    score += 10;
  }
  reasons.push(
    ctx.visitsThisMonth === 0
      ? "No visits this month"
      : `${ctx.visitsThisMonth} visit${ctx.visitsThisMonth === 1 ? "" : "s"} this month`,
  );

  return {
    id: expert.id,
    name: expert.name,
    designation: expert.designation,
    designationLabel: DESIGNATION_LABELS[expert.designation] ?? expert.designation.replace(/_/g, " "),
    city: expert.city,
    state: expert.state,
    score,
    distanceKm,
    visitsThisMonth: ctx.visitsThisMonth,
    available,
    reasons,
    userId: expert.userId,
  };
}

// ---------------------------------------------------------------------------
// panel proposal
// ---------------------------------------------------------------------------

export type PanelProposal = {
  lowTrust: boolean;
  trustScore: number;
  window: { start: string; end: string };
  slots: {
    key: string;
    role: string;
    label: string;
    designations: string[];
    note?: string;
    selected: ScoredExpert | null;
    alternates: ScoredExpert[];
  }[];
  total: number;
  warning?: string;
};

/**
 * Build the best available panel for one visit.
 * `college` needs coordinates; `trustScore` decides whether the chair must be
 * professor level.
 */
export async function proposePanel(args: {
  college: { latitude: number | null; longitude: number | null; state: string };
  trustScore: number;
  windowStart: Date;
  windowEnd: Date;
}): Promise<PanelProposal> {
  const lowTrust = args.trustScore < LOW_TRUST_THRESHOLD;
  const experts = await db.expert.findMany({ orderBy: { name: "asc" } });

  const scored: ScoredExpert[] = await Promise.all(
    experts.map(async (e) =>
      scoreExpert(e, {
        college: args.college,
        window: { start: args.windowStart, end: args.windowEnd },
        visitsThisMonth: await visitsThisMonth(e.id, args.windowStart),
      }),
    ),
  );

  const used = new Set<string>();
  const slots: PanelProposal["slots"] = [];

  for (const slot of PANEL_SLOTS) {
    const allowed = slot.key === "CHAIR" && lowTrust ? ["PROFESSOR_LEVEL"] : slot.allowed;
    let pool = scored.filter((e) => allowed.includes(e.designation) && !used.has(e.id));
    // Never propose someone who is unavailable or conflicted.
    pool = pool.filter((e) => e.available && !e.reasons.some((r) => r === "Conflict state" || r === "Same state as college"));

    const ranked = [...pool].sort((a, b) => b.score - a.score);
    const selected = ranked[0] ?? null;
    if (selected) used.add(selected.id);

    slots.push({
      key: slot.key,
      role: slot.role,
      label: slot.label,
      designations: allowed,
      note: slot.key === "CHAIR" && lowTrust ? "Trust score below 50 — chair restricted to professor level" : undefined,
      selected,
      alternates: ranked.slice(1, 7),
    });
  }

  const total = slots.reduce((sum, s) => sum + (s.selected?.score ?? 0), 0);
  const incomplete = slots.filter((s) => !s.selected);

  return {
    lowTrust,
    trustScore: args.trustScore,
    window: { start: args.windowStart.toISOString(), end: args.windowEnd.toISOString() },
    slots,
    total,
    warning: incomplete.length
      ? `No eligible, conflict-free expert found for: ${incomplete.map((s) => s.label).join(", ")}. Widen the window or empanel more experts in ${args.college.state}.`
      : undefined,
  };
}
