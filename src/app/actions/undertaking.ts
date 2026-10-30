"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notifyInstitution, notifyRole } from "@/lib/notify";
import { addDays } from "@/lib/time";
import { computeNext } from "@/lib/workflow";
import { parseStringArray } from "@/lib/json";
import type { StageKey } from "@/lib/constants";
import { recordTrustEvent } from "@/lib/trust";
import { getLiveMagicLink, MAGIC_ACTOR } from "@/lib/magic";
import type { ActionState } from "./application";

// ---------------------------------------------------------------------------
// Institution responds to a deficiency or an undertaking
// ---------------------------------------------------------------------------

export async function respondToUndertaking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "INSTITUTION") return { error: "Only the institution can respond to an undertaking." };

  const id = String(formData.get("undertakingId") ?? "");
  const fileName = String(formData.get("fileName") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!fileName) return { error: "Attach the document (file name / reference) as proof of compliance." };

  const u = await db.undertaking.findUnique({
    where: { id },
    include: { application: true, institution: { select: { id: true, name: true, regionId: true } } },
  });
  if (!u) return { error: "Undertaking not found." };
  if (u.institutionId !== user.institutionId) return { error: "This undertaking belongs to another institution." };

  await db.$transaction([
    db.complianceSubmission.create({
      data: {
        undertakingId: u.id,
        fileName,
        note: note || null,
        status: "SUBMITTED",
        submittedBy: user.name,
      },
    }),
    db.undertaking.update({ where: { id: u.id }, data: { status: "SUBMITTED" } }),
  ]);

  await audit(user.name, "UNDERTAKING_RESPONSE", "Undertaking", u.id, { fileName, note });

  await notifyRole("COMPLIANCE_OFFICER", {
    type: "UNDERTAKING_SUBMITTED",
    title: `Awaiting verification: ${u.title}`,
    body: `${u.institution.name} uploaded ${fileName}.`,
    link: `/undertakings`,
  }, u.institution.regionId);

  // A pre-approval deficiency reply returns the case file to re-scrutiny automatically.
  if (u.phase === "PRE" && u.application && u.application.currentStage === "INSTITUTION_RESPONSE") {
    const route = parseStringArray(u.application.routeSnapshot) as StageKey[];
    const result = computeNext({ action: "RESUBMIT", currentStage: "INSTITUTION_RESPONSE", route });
    if (!("error" in result)) {
      await db.application.update({
        where: { id: u.application.id },
        data: {
          currentStage: result.toStage,
          status: result.newStatus,
          stageEnteredAt: new Date(),
          dueAt: addDays(new Date(), 7),
          escalationLevel: 0,
        },
      });
      await db.stageTransition.create({
        data: {
          applicationId: u.application.id,
          fromStage: "INSTITUTION_RESPONSE",
          toStage: result.toStage,
          action: "RESUBMIT",
          actorName: user.name,
          actorRole: user.role,
          reason: `Institution responded: ${u.title}`,
        },
      });
      await notifyRole("SCRUTINY_OFFICER", {
        type: "STAGE_CHANGE",
        title: `${u.application.refNumber} is back for re-scrutiny`,
        body: `${u.institution.name} replied to the deficiency and uploaded ${fileName}.`,
        link: `/applications/${u.application.id}`,
      }, u.institution.regionId);
    }
  } else {
    await notifyRole("SCRUTINY_OFFICER", {
      type: "UNDERTAKING_SUBMITTED",
      title: `Compliance submitted: ${u.title}`,
      body: `${u.institution.name} — awaiting verification by the compliance officer.`,
      link: `/undertakings`,
    }, u.institution.regionId);
  }

  revalidatePath(`/institution/respond/${u.id}`);
  revalidatePath("/undertakings");
  revalidatePath("/dashboard");
  if (u.applicationId) revalidatePath(`/applications/${u.applicationId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Compliance officer verifies (or rejects) the submission
// ---------------------------------------------------------------------------

export async function verifySubmission(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["COMPLIANCE_OFFICER", "SCRUTINY_OFFICER", "REGIONAL_OFFICER", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "Only a compliance or scrutiny officer can verify a submission." };
  }

  const submissionId = String(formData.get("submissionId") ?? "");
  const decision = String(formData.get("decision") ?? "VERIFIED");
  const note = String(formData.get("note") ?? "").trim();

  if (decision === "REJECTED" && !note) return { error: "Record why the submission is being rejected." };

  const sub = await db.complianceSubmission.findUnique({
    where: { id: submissionId },
    include: { undertaking: { include: { institution: { select: { id: true, name: true, regionId: true } } } } },
  });
  if (!sub) return { error: "Submission not found." };

  await db.complianceSubmission.update({
    where: { id: sub.id },
    data: {
      status: decision,
      rejectionNote: decision === "REJECTED" ? note : null,
      verifiedBy: user.name,
      verifiedAt: new Date(),
    },
  });

  await db.undertaking.update({
    where: { id: sub.undertakingId },
    data: {
      status: decision === "VERIFIED" ? "VERIFIED" : "PENDING",
      verifiedAt: decision === "VERIFIED" ? new Date() : null,
      verifiedBy: decision === "VERIFIED" ? user.name : null,
      remindedTiers: decision === "VERIFIED" ? "[]" : undefined,
    },
  });

  await audit(user.name, decision === "VERIFIED" ? "UNDERTAKING_VERIFIED" : "UNDERTAKING_REJECTED", "Undertaking", sub.undertakingId, {
    fileName: sub.fileName,
    note,
  });


  // Feature 1 — closing a condition on time nudges the trust score back up.
  if (decision === "VERIFIED") {
    const onTime = sub.undertaking.dueAt ? new Date() <= new Date(sub.undertaking.dueAt) : true;
    if (onTime) {
      await recordTrustEvent({
        institutionId: sub.undertaking.institutionId,
        applicationId: sub.undertaking.applicationId,
        event: "COMPLIANCE_ON_TIME",
        note: `Verified on time: ${sub.undertaking.title}`,
      });
    }
  }

  await notifyInstitution(sub.undertaking.institutionId, {
    type: decision === "VERIFIED" ? "UNDERTAKING_VERIFIED" : "UNDERTAKING_REJECTED",
    title: decision === "VERIFIED" ? `Verified: ${sub.undertaking.title}` : `Re-submission required: ${sub.undertaking.title}`,
    body:
      decision === "VERIFIED"
        ? `${user.name} verified your submission (${sub.fileName}). This condition is now closed.`
        : `Rejected — ${note}`,
    link: `/institution/respond/${sub.undertakingId}`,
  });

  revalidatePath("/undertakings");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Officer records an undertaking manually (deficiency or condition)
// ---------------------------------------------------------------------------

export async function createUndertaking(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["COMPLIANCE_OFFICER", "SCRUTINY_OFFICER", "REGIONAL_OFFICER", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "You are not permitted to record an undertaking." };
  }

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const days = Number(formData.get("days") ?? 30);
  const institutionId = String(formData.get("institutionId") ?? "");
  const applicationId = String(formData.get("applicationId") ?? "") || null;
  const phase = String(formData.get("phase") ?? "POST");

  if (!title) return { error: "Give the undertaking a title." };
  if (!institutionId) return { error: "Select the institution responsible." };

  const u = await db.undertaking.create({
    data: {
      title,
      description,
      phase,
      dueAt: addDays(new Date(), Number.isFinite(days) && days > 0 ? days : 30),
      status: "PENDING",
      institutionId,
      applicationId,
    },
    include: { institution: { select: { name: true, regionId: true } } },
  });

  await audit(user.name, "UNDERTAKING_CREATED", "Undertaking", u.id, { title, days, institution: u.institution.name });

  await notifyInstitution(institutionId, {
    type: "UNDERTAKING_CREATED",
    title: `New compliance requirement: ${title}`,
    body: description || `Due within ${days} days. Upload proof before the deadline.`,
    link: `/institution/respond/${u.id}`,
  });

  revalidatePath("/undertakings");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Feature 6 — respond through a magic link (no login)
// ---------------------------------------------------------------------------

export async function respondViaMagicLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const fileName = String(formData.get("fileName") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!fileName) return { error: "Attach the document (file name / reference) as proof of compliance." };

  const link = await getLiveMagicLink(token);
  if (!link) return { error: "This link has expired or has already been used. Sign in to the portal to respond." };
  if (link.purpose !== "UNDERTAKING_RESPONSE") return { error: "This link cannot be used for that action." };

  const u = await db.undertaking.findUnique({
    where: { id: link.entityId },
    include: { application: true, institution: { select: { id: true, name: true, regionId: true } } },
  });
  if (!u || u.institutionId !== link.institutionId) return { error: "This compliance item no longer exists." };

  await db.$transaction([
    db.complianceSubmission.create({
      data: {
        undertakingId: u.id,
        fileName,
        note: note || null,
        status: "SUBMITTED",
        submittedBy: MAGIC_ACTOR,
      },
    }),
    db.undertaking.update({ where: { id: u.id }, data: { status: "SUBMITTED" } }),
    db.magicLink.update({ where: { id: link.id }, data: { usedAt: new Date() } }),
  ]);

  await audit(MAGIC_ACTOR, "UNDERTAKING_RESPONSE_MAGIC_LINK", "Undertaking", u.id, {
    fileName,
    note,
    linkId: link.id,
  });

  await notifyRole(
    "COMPLIANCE_OFFICER",
    {
      type: "UNDERTAKING_SUBMITTED",
      title: `Awaiting verification: ${u.title}`,
      body: `${u.institution.name} uploaded ${fileName} through a magic link.`,
      link: `/undertakings`,
    },
    u.institution.regionId,
  );

  // Same workflow effect as a logged-in reply: a pre-approval deficiency reply
  // returns the case file to re-scrutiny.
  if (u.phase === "PRE" && u.application && u.application.currentStage === "INSTITUTION_RESPONSE") {
    const route = parseStringArray(u.application.routeSnapshot) as StageKey[];
    const result = computeNext({ action: "RESUBMIT", currentStage: "INSTITUTION_RESPONSE", route });
    if (!("error" in result)) {
      await db.application.update({
        where: { id: u.application.id },
        data: {
          currentStage: result.toStage,
          status: result.newStatus,
          stageEnteredAt: new Date(),
          dueAt: addDays(new Date(), 7),
          escalationLevel: 0,
          remindedTiers: "[]",
        },
      });
      await db.stageTransition.create({
        data: {
          applicationId: u.application.id,
          fromStage: "INSTITUTION_RESPONSE",
          toStage: result.toStage,
          action: "RESUBMIT",
          actorName: MAGIC_ACTOR,
          actorRole: "INSTITUTION",
          reason: "Institution replied to the deficiency through a magic link.",
        },
      });
    }
  }

  revalidatePath("/undertakings");
  revalidatePath("/dashboard");
  return { ok: true };
}
