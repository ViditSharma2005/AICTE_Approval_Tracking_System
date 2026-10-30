/**
 * Feature 6 — magic links.
 *
 * A one-purpose, expiring, single-use URL that lets an institution act on one
 * compliance item without logging in. The link is not a login: it can only do
 * the single thing named in `purpose`, and every use is audited as
 * "Institution (magic link)".
 */

import { randomBytes } from "crypto";
import { db } from "./db";
import { addHours } from "./time";

export const MAGIC_LINK_TTL_HOURS = 72;

export type MagicPurpose = "UNDERTAKING_RESPONSE" | "DOCUMENT_RENEWAL";

export const MAGIC_ACTOR = "Institution (magic link)";

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Create a link valid for `ttlHours` (default 72). */
export async function issueMagicLink(args: {
  purpose: MagicPurpose;
  entityId: string;
  institutionId: string;
  ttlHours?: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = addHours(new Date(), args.ttlHours ?? MAGIC_LINK_TTL_HOURS);
  await db.magicLink.create({
    data: {
      token,
      purpose: args.purpose,
      entityId: args.entityId,
      institutionId: args.institutionId,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export function magicLinkPath(token: string): string {
  return `/respond/magic/${token}`;
}

/** Fetch a link only if it exists, is unused and has not expired. */
export async function getLiveMagicLink(token: string) {
  const link = await db.magicLink.findUnique({ where: { token } });
  if (!link) return null;
  if (link.usedAt) return null;
  if (link.expiresAt.getTime() < Date.now()) return null;
  return link;
}

/** Why a link cannot be used — for the clean expired/used state. */
export async function magicLinkState(token: string): Promise<"OK" | "USED" | "EXPIRED" | "NOT_FOUND"> {
  const link = await db.magicLink.findUnique({ where: { token } });
  if (!link) return "NOT_FOUND";
  if (link.usedAt) return "USED";
  if (link.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return "OK";
}
