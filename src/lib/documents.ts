/**
 * Shared document actions used by both the scheduler and the OCR pipeline,
 * so "this document has lapsed" always produces the same escalation, the same
 * notification and the same trust event — whoever notices it first.
 */

import { db } from "./db";
import { notifyInstitution, notifyRole } from "./notify";
import { audit } from "./audit";
import { recordTrustEvent } from "./trust";

/** Mark a document EXPIRED, escalate it and inform both sides. Idempotent. */
export async function expireDocument(docId: string): Promise<boolean> {
  const doc = await db.document.findUnique({
    where: { id: docId },
    include: { institution: { select: { id: true, name: true, regionId: true } } },
  });
  if (!doc || doc.status === "EXPIRED") return false;

  const label = doc.type.replace(/_/g, " ");

  await db.document.update({ where: { id: doc.id }, data: { status: "EXPIRED" } });
  await db.escalation.create({
    data: {
      entityType: "DOCUMENT",
      entityId: doc.id,
      level: 1,
      toRole: "COMPLIANCE_OFFICER",
      reason: `${label} of ${doc.institution.name} expired on ${doc.expiresAt.toDateString()} without renewal.`,
    },
  });
  await notifyRole(
    "COMPLIANCE_OFFICER",
    {
      type: "DOC_EXPIRED",
      title: `Document expired: ${label}`,
      body: `${doc.institution.name} — no renewed copy was uploaded before expiry.`,
      link: `/documents`,
    },
    doc.institution.regionId,
  );
  await notifyInstitution(doc.institutionId, {
    type: "DOC_EXPIRED",
    title: `${label} has expired`,
    body: "Upload the renewed document immediately; the lapse has been escalated to the Compliance Officer.",
    link: `/documents`,
  });
  await audit("SYSTEM", "DOCUMENT_EXPIRED", "Document", doc.id, { type: doc.type, institution: doc.institution.name });
  await recordTrustEvent({
    institutionId: doc.institutionId,
    event: "DOC_EXPIRED",
    note: `${label} expired without renewal`,
  });

  return true;
}

/**
 * Flag a date mismatch between what the institution typed and what the reader
 * found on the document, and ask the compliance officer to settle it.
 */
export async function raiseDateConflict(args: {
  docId: string;
  institutionId: string;
  institutionName: string;
  regionId: string | null;
  docType: string;
  enteredDate: Date;
  ocrDate: Date;
}): Promise<void> {
  const label = args.docType.replace(/_/g, " ");
  await notifyRole(
    "COMPLIANCE_OFFICER",
    {
      type: "DOC_DATE_CONFLICT",
      title: `Date mismatch: ${label} — ${args.institutionName}`,
      body: `The ${label} expiry date differs from the date entered in the portal. Entered ${args.enteredDate
        .toISOString()
        .slice(0, 10)}, read from the document ${args.ocrDate.toISOString().slice(0, 10)}. Please verify and confirm the correct date.`,
      link: `/documents`,
    },
    args.regionId,
  );
  await notifyInstitution(args.institutionId, {
    type: "DOC_DATE_CONFLICT",
    title: `Date check needed on your ${label}`,
    body: `The date read from your uploaded document (${args.ocrDate
      .toISOString()
      .slice(0, 10)}) differs from the one you entered (${args.enteredDate.toISOString().slice(0, 10)}). The compliance officer will confirm the correct date.`,
    link: `/documents`,
  });
}
