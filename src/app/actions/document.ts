"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notifyInstitution, notifyRole } from "@/lib/notify";
import { toJson } from "@/lib/json";
import { extractDocumentData, datesConflict, encodeSummary } from "@/lib/ocr";
import { expireDocument, raiseDateConflict } from "@/lib/documents";
import { DOC_TYPES } from "@/lib/constants";
import type { ActionState } from "./application";

function parseDate(raw: unknown): Date | null {
  const d = new Date(String(raw ?? ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Institution registers a document with a validity date
// ---------------------------------------------------------------------------

export async function addDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["INSTITUTION", "COMPLIANCE_OFFICER", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "You are not permitted to add documents." };
  }

  const type = String(formData.get("type") ?? "");
  const fileName = String(formData.get("fileName") ?? "").trim();
  const expiresAt = parseDate(formData.get("expiresAt"));
  const institutionId = String(formData.get("institutionId") ?? user.institutionId ?? "");

  if (!DOC_TYPES.includes(type as (typeof DOC_TYPES)[number])) return { error: "Select a document type." };
  if (!fileName) return { error: "Enter the file name / reference of the document." };
  if (!expiresAt) return { error: "Enter the validity end date." };
  if (!institutionId) return { error: "Select the institution." };

  const doc = await db.document.create({
    data: { type, fileName, expiresAt, institutionId, status: "VALID" },
    include: { institution: { select: { name: true, regionId: true } } },
  });

  // Feature 2 — read the document and compare its printed date with the one entered.
  const extraction = await extractDocumentData(fileName, type);
  const conflict = datesConflict(expiresAt, extraction.expiryDate);
  await db.document.update({
    where: { id: doc.id },
    data: {
      enteredDate: expiresAt,
      ocrExtractedDate: extraction.expiryDate,
      ocrConfidence: extraction.confidence,
      aiSummary: encodeSummary(extraction),
      dateConflict: conflict,
      officerConfirmed: false,
    },
  });

  if (conflict && extraction.expiryDate) {
    await raiseDateConflict({
      docId: doc.id,
      institutionId,
      institutionName: doc.institution.name,
      regionId: doc.institution.regionId,
      docType: type,
      enteredDate: expiresAt,
      ocrDate: extraction.expiryDate,
    });
    await audit("SYSTEM", "DOC_DATE_CONFLICT", "Document", doc.id, {
      enteredDate: expiresAt.toISOString(),
      ocrDate: extraction.expiryDate.toISOString(),
      engine: extraction.engine,
    });
  }

  // A date already in the past is a lapse, not a warning — escalate immediately.
  const effective = extraction.expiryDate && extraction.expiryDate < new Date() ? "OCR" : null;
  if (effective === "OCR") {
    await db.document.update({
      where: { id: doc.id },
      data: { expiresAt: extraction.expiryDate as Date, enteredDate: expiresAt },
    });
    await expireDocument(doc.id);
    await audit(user.name, "DOC_EXPIRED_ON_UPLOAD", "Document", doc.id, {
      ocrDate: (extraction.expiryDate as Date).toISOString(),
      engine: extraction.engine,
    });
  }

  await audit(user.name, "DOCUMENT_ADDED", "Document", doc.id, {
    type,
    fileName,
    expiresAt: expiresAt.toISOString(),
    ocrDate: extraction.expiryDate?.toISOString() ?? null,
    ocrEngine: extraction.engine,
    dateConflict: conflict,
  });

  revalidatePath("/documents");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Institution uploads the renewed copy
// ---------------------------------------------------------------------------

export async function renewDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();

  const docId = String(formData.get("docId") ?? "");
  const fileName = String(formData.get("fileName") ?? "").trim();
  const expiresAt = parseDate(formData.get("expiresAt"));
  const note = String(formData.get("note") ?? "").trim();

  if (!fileName) return { error: "Enter the file name / reference of the renewed document." };
  if (!expiresAt) return { error: "Enter the new validity end date." };
  if (expiresAt.getTime() < Date.now()) return { error: "The renewed document must be valid from today." };

  const doc = await db.document.findUnique({
    where: { id: docId },
    include: { institution: { select: { id: true, name: true, regionId: true } } },
  });
  if (!doc) return { error: "Document not found." };
  if (user.role === "INSTITUTION" && doc.institutionId !== user.institutionId) {
    return { error: "This document belongs to another institution." };
  }

  await db.document.update({
    where: { id: doc.id },
    data: {
      status: "RENEWAL_SUBMITTED",
      renewalUrl: fileName,
      renewalNote: note || null,
      renewalSubmittedAt: new Date(),
      rejectionNote: null,
    },
  });

  await audit(user.name, "DOCUMENT_RENEWAL_SUBMITTED", "Document", doc.id, {
    fileName,
    newExpiry: expiresAt.toISOString(),
    note,
  });

  // store the proposed new expiry on the note field so the verifier can apply it
  await db.document.update({ where: { id: doc.id }, data: { renewalNote: `[valid till ${expiresAt.toISOString().slice(0, 10)}] ${note}`.trim() } });

  // Feature 2 — read the renewed copy and compare against the date entered.
  const extraction = await extractDocumentData(fileName, doc.type);
  const conflict = datesConflict(expiresAt, extraction.expiryDate);
  await db.document.update({
    where: { id: doc.id },
    data: {
      enteredDate: expiresAt,
      ocrExtractedDate: extraction.expiryDate,
      ocrConfidence: extraction.confidence,
      aiSummary: encodeSummary(extraction),
      dateConflict: conflict,
      officerConfirmed: false,
    },
  });

  if (conflict && extraction.expiryDate) {
    await raiseDateConflict({
      docId: doc.id,
      institutionId: doc.institutionId,
      institutionName: doc.institution.name,
      regionId: doc.institution.regionId,
      docType: doc.type,
      enteredDate: expiresAt,
      ocrDate: extraction.expiryDate,
    });
    await audit("SYSTEM", "DOC_DATE_CONFLICT", "Document", doc.id, {
      enteredDate: expiresAt.toISOString(),
      ocrDate: extraction.expiryDate.toISOString(),
      engine: extraction.engine,
    });
  }

  await notifyRole("COMPLIANCE_OFFICER", {
    type: "DOC_RENEWAL",
    title: `Renewal submitted: ${doc.type.replace(/_/g, " ")}`,
    body: `${doc.institution.name} uploaded ${fileName}. Verify and update the register.`,
    link: `/documents`,
  }, doc.institution.regionId);

  revalidatePath("/documents");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Compliance officer verifies the renewal
// ---------------------------------------------------------------------------

export async function verifyDocumentRenewal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["COMPLIANCE_OFFICER", "REGIONAL_OFFICER", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "Only the compliance officer can verify a renewal." };
  }

  const docId = String(formData.get("docId") ?? "");
  const decision = String(formData.get("decision") ?? "VERIFIED");
  const note = String(formData.get("note") ?? "").trim();

  const doc = await db.document.findUnique({
    where: { id: docId },
    include: { institution: { select: { id: true, name: true, regionId: true } } },
  });
  if (!doc) return { error: "Document not found." };

  if (decision === "REJECTED") {
    if (!note) return { error: "Record why the renewal is rejected." };
    await db.document.update({
      where: { id: doc.id },
      data: { status: "EXPIRED", renewalUrl: null, renewalSubmittedAt: null, rejectionNote: note },
    });
    await notifyInstitution(doc.institutionId, {
      type: "DOC_RENEWAL_REJECTED",
      title: `Renewal rejected: ${doc.type.replace(/_/g, " ")}`,
      body: note,
      link: `/documents`,
    });
  } else {
    // pull the new validity date out of the renewal note the institution submitted
    const match = /\[valid till (\d{4}-\d{2}-\d{2})\]/.exec(doc.renewalNote ?? "");
    const newExpiry = match ? new Date(match[1]) : doc.expiresAt;

    await db.document.update({
      where: { id: doc.id },
      data: {
        status: "VALID",
        fileName: doc.renewalUrl ?? doc.fileName,
        expiresAt: newExpiry,
        alertedTiers: toJson([]),
        renewalUrl: null,
        renewalNote: null,
        renewalSubmittedAt: null,
        rejectionNote: null,
        verifiedBy: user.name,
      },
    });

    await notifyInstitution(doc.institutionId, {
      type: "DOC_RENEWAL_VERIFIED",
      title: `Renewal verified: ${doc.type.replace(/_/g, " ")}`,
      body: `Valid till ${newExpiry.toLocaleDateString("en-IN", { dateStyle: "medium" })}. The expiry countdown has restarted.`,
      link: `/documents`,
    });
  }

  await audit(user.name, decision === "VERIFIED" ? "DOCUMENT_RENEWAL_VERIFIED" : "DOCUMENT_RENEWAL_REJECTED", "Document", doc.id, {
    type: doc.type,
    note,
  });

  revalidatePath("/documents");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/escalations");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Feature 2 — an officer resolves the entered-vs-OCR date conflict
// ---------------------------------------------------------------------------

export async function confirmDocumentDate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["COMPLIANCE_OFFICER", "REGIONAL_OFFICER", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "Only the compliance officer can confirm a document date." };
  }

  const docId = String(formData.get("docId") ?? "");
  const choice = String(formData.get("choice") ?? "ENTERED"); // ENTERED | OCR
  const note = String(formData.get("note") ?? "").trim();

  const doc = await db.document.findUnique({
    where: { id: docId },
    include: { institution: { select: { id: true, name: true, regionId: true } } },
  });
  if (!doc) return { error: "Document not found." };

  const chosen = choice === "OCR" ? doc.ocrExtractedDate : doc.enteredDate;
  if (!chosen) return { error: "There is no date to confirm." };

  const wasConflict = doc.dateConflict;

  await db.document.update({
    where: { id: doc.id },
    data: {
      expiresAt: chosen,
      dateConflict: false,
      officerConfirmed: true,
      alertedTiers: toJson([]),
      verifiedBy: user.name,
      rejectionNote: null,
    },
  });

  // If the confirmed date is already behind us, the document has lapsed.
  if (chosen.getTime() < Date.now()) await expireDocument(doc.id);

  await audit(user.name, "DOCUMENT_DATE_CONFIRMED", "Document", doc.id, {
    choice,
    date: chosen.toISOString(),
    wasConflict,
    note,
  });

  await notifyInstitution(doc.institutionId, {
    type: "DOC_DATE_CONFIRMED",
    title: `Date confirmed: ${doc.type.replace(/_/g, " ")}`,
    body: `${user.name} confirmed ${chosen.toLocaleDateString("en-IN", { dateStyle: "medium" })} as the validity end date.`,
    link: `/documents`,
  });

  revalidatePath("/documents");
  revalidatePath("/dashboard");
  revalidatePath("/applications");
  return { ok: true };
}
