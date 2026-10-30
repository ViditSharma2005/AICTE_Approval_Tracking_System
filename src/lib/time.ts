/**
 * Time helpers + demo time-compression.
 *
 * In DEMO_MODE one "day" lasts DEMO_DAY_MS milliseconds (default 10s), so a
 * 7-day SLA expires in 70 real seconds and judges can watch reminders fire and
 * escalations climb live. With DEMO_MODE=false everything is a real 24h day.
 */

export const DEMO_MODE = process.env.DEMO_MODE === "true";
export const DEMO_DAY_MS = Number(process.env.DEMO_DAY_MS ?? 10_000);
export const MS_PER_DAY = DEMO_MODE ? DEMO_DAY_MS : 24 * 60 * 60 * 1000;

/** "Add days" (demo-aware). Fractional days are allowed. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Signed number of days from -> to (fractional). Negative = in the past. */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/** Whole days elapsed since a date (never negative). */
export function daysSince(date: Date, now = new Date()): number {
  return Math.max(0, Math.floor(daysBetween(date, now)));
}

/**
 * Whole calendar days remaining until `date` (what a human would say).
 * In demo mode this is compressed days.
 */
export function daysUntil(date: Date, now = new Date()): number {
  return Math.ceil(daysBetween(now, date));
}

/** Human label for a deadline: "in 4 days", "today", "3 days overdue". */
export function deadlineLabel(due: Date | null | undefined, now = new Date()): string {
  if (!due) return "No deadline";
  const d = daysUntil(due, now);
  if (d > 1) return `in ${d} days`;
  if (d === 1) return "tomorrow";
  if (d === 0) return "due today";
  if (d === -1) return "1 day overdue";
  return `${Math.abs(d)} days overdue`;
}

export function isOverdue(date: Date | null | undefined, now = new Date()): boolean {
  return !!date && date.getTime() < now.getTime();
}

// Re-exported for convenience: most screens import dates and deadlines together.
export { fmtDate, fmtDateTime, fmtRelative, fmtNumber, fmtPct } from "./format";
