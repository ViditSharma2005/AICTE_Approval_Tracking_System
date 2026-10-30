/**
 * Tiny JSON helpers for the String columns that hold JSON payloads.
 * Keeps the schema portable between SQLite and PostgreSQL.
 */

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseStringArray(raw: string | null | undefined): string[] {
  const value = parseJson<unknown>(raw, []);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function parseNumberMap(raw: string | null | undefined): Record<string, number> {
  const value = parseJson<unknown>(raw, {});
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function parseNumberArray(raw: string | null | undefined): number[] {
  const value = parseJson<unknown>(raw, []);
  return Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : [];
}
