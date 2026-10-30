import { daysBetween } from "./time";

export type PriorityInput = {
  dueAt: Date | null;
  escalationLevel: number;
  stageEnteredAt: Date;
  evcStatus?: string | null;
  overdueUndertakings?: number;
  docExpiring?: boolean;
};

export type PriorityResult = {
  score: number;
  band: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasons: { label: string; points: number }[];
};

/**
 * Explainable priority score — clicking any score in the UI shows the breakdown,
 * so an officer never has to trust a number they cannot interrogate.
 */
export function priorityScore(input: PriorityInput, now = new Date()): PriorityResult {
  const reasons: { label: string; points: number }[] = [];

  const overdueDays = input.dueAt ? Math.max(0, Math.floor(daysBetween(input.dueAt, now))) : 0;
  if (overdueDays > 0) reasons.push({ label: `${overdueDays} day(s) past SLA`, points: overdueDays * 10 });

  if (input.escalationLevel > 0)
    reasons.push({ label: `Escalated to level ${input.escalationLevel}`, points: input.escalationLevel * 15 });

  if (input.evcStatus === "OVERDUE") reasons.push({ label: "EVC visit overdue", points: 20 });

  if (input.overdueUndertakings && input.overdueUndertakings > 0)
    reasons.push({
      label: `${input.overdueUndertakings} overdue undertaking(s)`,
      points: input.overdueUndertakings * 10,
    });

  if (input.docExpiring) reasons.push({ label: "Supporting document expired", points: 10 });

  const daysInStage = Math.max(0, Math.floor(daysBetween(input.stageEnteredAt, now)));
  if (daysInStage > 14) reasons.push({ label: `${daysInStage} days in current stage`, points: 5 });

  const score = reasons.reduce((sum, r) => sum + r.points, 0);
  const band: PriorityResult["band"] =
    score >= 60 ? "CRITICAL" : score >= 30 ? "HIGH" : score > 0 ? "MEDIUM" : "LOW";

  return { score, band, reasons };
}

export const PRIORITY_BAND_TONE: Record<PriorityResult["band"], "green" | "amber" | "orange" | "red"> = {
  LOW: "green",
  MEDIUM: "amber",
  HIGH: "orange",
  CRITICAL: "red",
};
