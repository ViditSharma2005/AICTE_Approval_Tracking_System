const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return DATE_FMT.format(new Date(d));
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return DATE_TIME_FMT.format(new Date(d));
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  const diffMs = date.getTime() - Date.now();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return mins > 0 ? `in ${mins} min` : `${Math.abs(mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return hours > 0 ? `in ${hours} h` : `${Math.abs(hours)} h ago`;
  const days = Math.round(hours / 24);
  return days > 0 ? `in ${days} d` : `${Math.abs(days)} d ago`;
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

export function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

/** "AICTE-2026-NR-0042" style reference numbers. */
export function buildRefNumber(regionCode: string, seq: number, year = new Date().getFullYear()) {
  return `AICTE-${year}-${regionCode}-${String(seq).padStart(4, "0")}`;
}

export function titleCaseSlug(s: string): string {
  return s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function daysLeftTone(days: number): "green" | "amber" | "red" {
  if (days <= 0) return "red";
  if (days <= 7) return "amber";
  return "green";
}

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}
