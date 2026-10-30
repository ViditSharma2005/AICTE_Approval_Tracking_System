/**
 * Feature 1 — Trust score: event-sourced and explainable.
 *
 * Design rules:
 *  - The events table is the source of truth; Institution.trustScore is a cached
 *    derivation recomputed after every write.
 *  - The score is DESCRIPTIVE ONLY. Nothing in this file, and nothing that calls
 *    it, may suspend, penalise or otherwise act on an institution automatically.
 *    Enforcement is a human decision (Feature 8: Suspension Recommendation).
 */

import { db } from "./db";

export type TrustEventType =
  | "LOR"
  | "DEFICIENCY_ITEM"
  | "UNDERTAKING_OVERDUE"
  | "DOC_EXPIRED"
  | "COMPLIANCE_ON_TIME"
  | "APPEAL_UPHELD";

export const TRUST_DELTAS: Record<TrustEventType, number> = {
  LOR: -15,
  DEFICIENCY_ITEM: -3,
  UNDERTAKING_OVERDUE: -10,
  DOC_EXPIRED: -8,
  COMPLIANCE_ON_TIME: 2,
  APPEAL_UPHELD: 5,
};

/** Total deduction a single application may contribute through deficiencies. */
export const DEFICIENCY_CAP_PER_APPLICATION = -12;

export const TRUST_EVENT_LABELS: Record<string, string> = {
  LOR: "Letter of Rejection (LoR)",
  DEFICIENCY_ITEM: "Deficiency item raised",
  UNDERTAKING_OVERDUE: "Undertaking went overdue",
  DOC_EXPIRED: "Statutory document expired",
  COMPLIANCE_ON_TIME: "Compliance verified on time",
  APPEAL_UPHELD: "Institution appeal upheld",
};

export function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function trustTone(score: number): "green" | "amber" | "red" {
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
}

export function trustLabel(score: number): string {
  if (score >= 80) return "Good standing";
  if (score >= 50) return "Watch list";
  return "Concern";
}

/**
 * Recompute and persist the cached score from the event history.
 * (Recomputing from events is what keeps the cache honest if a row is ever corrected.)
 */
export async function recomputeTrustScore(institutionId: string): Promise<number> {
  const rows = await db.trustScoreEvent.findMany({
    where: { institutionId },
    select: { delta: true },
  });
  const score = clampScore(100 + rows.reduce((sum, r) => sum + r.delta, 0));
  await db.institution.update({ where: { id: institutionId }, data: { trustScore: score } });
  return score;
}

export type RecordResult = { score: number; applied: boolean; reason?: string };

/**
 * Write one trust event and refresh the cache.
 * Deficiency items are capped per application so one messy case cannot sink an
 * institution on its own.
 */
export async function recordTrustEvent(params: {
  institutionId: string;
  event: TrustEventType;
  note?: string | null;
  applicationId?: string | null;
}): Promise<RecordResult> {
  const delta = TRUST_DELTAS[params.event];

  if (params.event === "DEFICIENCY_ITEM") {
    const prior = await db.trustScoreEvent.findMany({
      where: { institutionId: params.institutionId, event: "DEFICIENCY_ITEM", applicationId: params.applicationId ?? null },
      select: { delta: true },
    });
    const already = prior.reduce((s, r) => s + r.delta, 0);
    if (already <= DEFICIENCY_CAP_PER_APPLICATION) {
      return {
        score: await currentScore(params.institutionId),
        applied: false,
        reason: `Deficiency cap of ${DEFICIENCY_CAP_PER_APPLICATION} reached for this application (${already}).`,
      };
    }
  }

  await db.trustScoreEvent.create({
    data: {
      institutionId: params.institutionId,
      applicationId: params.applicationId ?? null,
      event: params.event,
      delta,
      note: params.note ?? null,
    },
  });

  const score = await recomputeTrustScore(params.institutionId);
  return { score, applied: true };
}

export async function currentScore(institutionId: string): Promise<number> {
  const inst = await db.institution.findUnique({
    where: { id: institutionId },
    select: { trustScore: true },
  });
  return inst?.trustScore ?? 100;
}

export type TrustBreakdown = {
  score: number;
  status: string;
  institution: { id: string; name: string; city: string; state: string };
  byType: { event: string; label: string; count: number; total: number }[];
  events: { id: string; event: string; label: string; delta: number; note: string | null; createdAt: Date; applicationId: string | null }[];
};

/** Everything the UI needs for the "why is this score what it is?" popover. */
export async function getTrustBreakdown(institutionId: string, limit = 25): Promise<TrustBreakdown | null> {
  const institution = await db.institution.findUnique({
    where: { id: institutionId },
    select: { id: true, name: true, city: true, state: true, trustScore: true, status: true },
  });
  if (!institution) return null;

  const events = await db.trustScoreEvent.findMany({
    where: { institutionId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const totals = await db.trustScoreEvent.groupBy({
    by: ["event"],
    where: { institutionId },
    _count: { _all: true },
    _sum: { delta: true },
  });

  return {
    score: institution.trustScore,
    status: institution.status,
    institution: { id: institution.id, name: institution.name, city: institution.city, state: institution.state },
    byType: totals
      .map((t) => ({
        event: t.event,
        label: TRUST_EVENT_LABELS[t.event] ?? t.event,
        count: t._count._all,
        total: t._sum.delta ?? 0,
      }))
      .sort((a, b) => a.total - b.total),
    events: events.map((e) => ({
      id: e.id,
      event: e.event,
      label: TRUST_EVENT_LABELS[e.event] ?? e.event,
      delta: e.delta,
      note: e.note,
      createdAt: e.createdAt,
      applicationId: e.applicationId,
    })),
  };
}
