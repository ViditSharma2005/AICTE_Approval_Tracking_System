"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notifyInstitution } from "@/lib/notify";
import { generateLetter, LETTER_META, type LetterType } from "@/lib/letters";
import { decideSuspension } from "@/lib/suspension";
import type { ActionState } from "./application";

const ALLOWED_LETTER_ROLES = ["SCRUTINY_OFFICER", "COMPLIANCE_OFFICER", "REGIONAL_OFFICER", "COMPETENT_AUTHORITY", "SYSTEM_ADMIN"];

/**
 * Feature 8 — record that an officer reviewed the draft and issued it.
 * This is the ONLY way a letter becomes SENT. Nothing in the system sends
 * a letter on its own.
 */
export async function markLetterSent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!ALLOWED_LETTER_ROLES.includes(user.role)) return { error: "Your role cannot issue letters." };

  const applicationId = String(formData.get("applicationId") ?? "");
  const type = String(formData.get("type") ?? "") as LetterType;
  if (!applicationId || !(type in LETTER_META)) return { error: "Letter type missing." };

  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, refNumber: true, institutionId: true, institution: { select: { name: true } } },
  });
  if (!app) return { error: "Application not found." };

  // Re-render at send time so the stored text matches exactly what was issued.
  const letter = await generateLetter(type, applicationId, { name: user.name, designation: user.designation });

  await db.letter.create({
    data: {
      applicationId,
      type,
      subject: letter.subject,
      body: letter.html,
      status: "SENT",
      reviewedBy: user.name,
      sentBy: user.name,
      sentAt: new Date(),
    },
  });

  await audit(user.name, "LETTER_SENT", "Application", applicationId, {
    refNumber: app.refNumber,
    letterType: LETTER_META[type].label,
    subject: letter.subject,
    template: letter.template,
  });

  await notifyInstitution(app.institutionId, {
    type: "LETTER_ISSUED",
    title: `${LETTER_META[type].label} issued — ${app.refNumber}`,
    body: `${letter.subject}. Issued by ${user.name}.`,
    link: `/applications/${applicationId}`,
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Feature 8 — the Competent Authority disposes of a suspension recommendation.
 * Only APPROVE sets the institution to SUSPENDED, and the decision is recorded
 * with the authority's own name in the audit trail.
 */
export async function decideSuspensionRecommendation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "COMPETENT_AUTHORITY" && user.role !== "SYSTEM_ADMIN") {
    return { error: "Only the Competent Authority can dispose of a suspension recommendation." };
  }

  const taskId = String(formData.get("taskId") ?? "");
  const decision = String(formData.get("decision") ?? ""); // APPROVED | REJECTED
  const note = String(formData.get("note") ?? "").trim();

  if (decision !== "APPROVED" && decision !== "REJECTED") return { error: "Record a decision." };

  const result = await decideSuspension({ taskId, decision, note, actorName: user.name });
  if (!result.ok) return { error: result.error ?? "The decision could not be recorded." };

  revalidatePath("/escalations");
  revalidatePath("/dashboard");
  revalidatePath("/applications");
  return { ok: true };
}
