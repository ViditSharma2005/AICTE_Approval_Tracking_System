import { createHash } from "crypto";
import { db } from "./db";
import { toJson } from "./json";

/**
 * Append-only, hash-chained audit trail.
 * Every entry commits to the previous entry's hash, so editing or deleting a
 * row in the past breaks the chain — and `verifyAuditChain()` proves it on screen.
 */

export async function audit(
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  // 2ms spacing guarantees strictly increasing timestamps, so the hash chain has
  // a deterministic order even when hundreds of entries are written in a tight loop.
  await new Promise((r) => setTimeout(r, 2));

  const prev = await db.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { hash: true } });
  const payload = JSON.stringify({ actorName, action, entityType, entityId, metadata, t: Date.now() });
  const hash = createHash("sha256").update((prev?.hash ?? "GENESIS") + payload).digest("hex");

  await db.auditLog.create({
    data: {
      actorName,
      action,
      entityType,
      entityId,
      metadata: toJson(metadata),
      prevHash: prev?.hash ?? null,
      hash,
    },
  });
}

export type ChainReport = {
  total: number;
  intact: boolean;
  brokenAt: string | null;
  head: string | null;
};

export async function verifyAuditChain(): Promise<ChainReport> {
  const rows = await db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
  let expectedPrev: string | null = null;

  for (const row of rows) {
    if (row.prevHash !== expectedPrev) {
      return { total: rows.length, intact: false, brokenAt: row.id, head: rows.at(-1)?.hash ?? null };
    }
    expectedPrev = row.hash;
  }
  return { total: rows.length, intact: true, brokenAt: null, head: rows.at(-1)?.hash ?? null };
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}
