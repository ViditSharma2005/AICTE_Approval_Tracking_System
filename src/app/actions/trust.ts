"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notifyInstitution } from "@/lib/notify";
import { recordTrustEvent } from "@/lib/trust";
import type { ActionState } from "./application";

/**
 * Feature 1 — an institution's appeal against a rejection / deficiency is upheld.
 * This is the only positive-correction event: it restores some standing after a
 * human has reviewed the institution's case.
 */
export async function recordAppealUpheld(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["REGIONAL_OFFICER", "BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "Only a Regional or Bureau officer can record an appeal outcome." };
  }

  const institutionId = String(formData.get("institutionId") ?? "");
  const applicationId = String(formData.get("applicationId") ?? "") || null;
  const note = String(formData.get("note") ?? "").trim();
  if (!institutionId) return { error: "Institution missing." };
  if (!note) return { error: "Record the basis on which the appeal was upheld." };

  const inst = await db.institution.findUnique({ where: { id: institutionId }, select: { id: true, name: true } });
  if (!inst) return { error: "Institution not found." };

  const res = await recordTrustEvent({ institutionId, applicationId, event: "APPEAL_UPHELD", note });

  await audit(user.name, "APPEAL_UPHELD", "Institution", institutionId, {
    note,
    applicationId,
    newScore: res.score,
  });

  await notifyInstitution(institutionId, {
    type: "APPEAL_UPHELD",
    title: "Your appeal was upheld",
    body: `${user.name} recorded the appeal outcome. Compliance trust score is now ${res.score}/100.`,
    link: applicationId ? `/applications/${applicationId}` : "/dashboard",
  });

  revalidatePath("/applications");
  revalidatePath(`/applications/${applicationId ?? ""}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
