"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notifyInstitution, notifyRole, notifyUser } from "@/lib/notify";
import { addDays } from "@/lib/time";
import { STAGES } from "@/lib/constants";
import { recordTrustEvent } from "@/lib/trust";
import { activeCaseCount, DEFAULT_MAX_ACTIVE_CASES, findAvailableOfficer, notifyPoolAtCapacity } from "@/lib/assignment";
import { parseNumberMap, parseStringArray, toJson } from "@/lib/json";
import { computeNext, availableActions, pickRoute, templateSlas, templateStages, type Action } from "@/lib/workflow";
import type { StageKey } from "@/lib/constants";
import { APP_TYPES } from "@/lib/constants";

export type ActionState = { error?: string; ok?: boolean };

// ---------------------------------------------------------------------------
// Institution submits a new application
// ---------------------------------------------------------------------------

export async function submitApplication(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "INSTITUTION") return { error: "Only institution users can submit applications." };
  if (!user.institutionId) return { error: "Your account is not linked to an institution." };

  const type = String(formData.get("type") ?? "");
  if (!(type in APP_TYPES)) return { error: "Select a valid application type." };

  const programName = String(formData.get("programName") ?? "").trim();
  const intake = Number(formData.get("intake") ?? 0);
  if (!programName) return { error: "Programme / course name is required." };

  const institution = await db.institution.findUniqueOrThrow({ where: { id: user.institutionId } });
  const templates = await db.routeTemplate.findMany({ where: { status: "PUBLISHED" } });

  const route = pickRoute(templates, { type, institutionType: institution.type });
  if (!route) return { error: "No published route matches this application type. Ask the policy administrator to publish a rule." };

  const stages = templateStages(route);
  const slas = templateSlas(route);
  const firstStage = stages[0] as StageKey;

  const now = new Date();
  const count = await db.application.count();
  const region = await db.region.findUniqueOrThrow({ where: { id: institution.regionId } });
  const refNumber = `AICTE-${now.getFullYear()}-${region.code}-${String(count + 1).padStart(4, "0")}`;

  // Feature 5 — assign to the lightest-loaded officer who is still under their cap.
  const assignedTo = await findAvailableOfficer("SCRUTINY_OFFICER", institution.regionId);

  const app = await db.application.create({
    data: {
      refNumber,
      type,
      status: "IN_PROGRESS",
      currentStage: firstStage,
      stageEnteredAt: now,
      dueAt: addDays(now, slas[firstStage] ?? 7),
      routeSnapshot: toJson(stages),
      slaSnapshot: toJson(slas),
      routeKey: route.key,
      routeVersion: route.version,
      routeTemplateId: route.id,
      institutionId: institution.id,
      regionId: institution.regionId,
      assignedToId: assignedTo?.id ?? null,
      programName,
      intake: Number.isFinite(intake) ? intake : 0,
      submittedAt: now,
      transitions: {
        create: {
          fromStage: null,
          toStage: firstStage,
          action: "SUBMIT",
          actorName: user.name,
          actorRole: user.role,
          reason: `Application submitted under ${route.name} (v${route.version}).`,
        },
      },
    },
  });

  if (!assignedTo) {
    // Nobody has room: the case waits in the unassigned queue rather than
    // piling onto an officer who is already at their cap.
    await notifyPoolAtCapacity({ role: "SCRUTINY_OFFICER", regionId: institution.regionId, refNumber });
    await audit("SYSTEM", "UNASSIGNED_QUEUE", "Application", app.id, {
      refNumber,
      reason: "Every scrutiny officer in this region is at their active-case cap.",
    });
  }

  await audit(user.name, "SUBMIT", "Application", app.id, {
    refNumber,
    type,
    route: route.key,
    routeVersion: route.version,
    snapshotStages: stages,
  });

  await notifyRole("SCRUTINY_OFFICER", {
    type: "NEW_APPLICATION",
    title: `New application ${refNumber}`,
    body: `${institution.name} — ${APP_TYPES[type as keyof typeof APP_TYPES]}.`,
    link: `/applications/${app.id}`,
  }, institution.regionId);

  if (assignedTo) {
    await notifyUser(assignedTo.id, {
      type: "ASSIGNED",
      title: `Assigned to you: ${refNumber}`,
      body: `${institution.name} — scrutiny SLA ${slas[firstStage] ?? 7} days.`,
      link: `/applications/${app.id}`,
    });
  }

  revalidatePath("/applications");
  revalidatePath("/dashboard");
  redirect(`/applications/${app.id}`);
}

// ---------------------------------------------------------------------------
// The single transition every human decision flows through
// ---------------------------------------------------------------------------

export async function performTransition(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();

  const applicationId = String(formData.get("applicationId") ?? "");
  const action = String(formData.get("action") ?? "") as Action;
  const reason = String(formData.get("reason") ?? "").trim() || undefined;

  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: { institution: { select: { id: true, name: true, regionId: true } }, evcVisit: true },
  });
  if (!app) return { error: "Application not found." };

  const allowed = availableActions({ role: user.role, stage: app.currentStage, evcStatus: app.evcVisit?.status });
  if (!allowed.includes(action)) {
    return { error: `Your role cannot perform "${action}" on a case at ${app.currentStage}.` };
  }

  const route = parseStringArray(app.routeSnapshot) as StageKey[];
  const slas = parseNumberMap(app.slaSnapshot);

  const result = computeNext({ action, currentStage: app.currentStage as StageKey, route, reason });
  if ("error" in result) return { error: result.error };

  // Conditional approval must carry at least one enforceable undertaking.
  const undertakings: { title: string; description: string; days: number }[] = [];
  if (action === "CONDITIONAL_APPROVE") {
    const titles = formData.getAll("ut_title").map(String).map((s) => s.trim()).filter(Boolean);
    const descs = formData.getAll("ut_desc").map(String);
    const daysArr = formData.getAll("ut_days").map((v) => Number(v));

    titles.forEach((title, i) => {
      undertakings.push({
        title,
        description: (descs[i] ?? "").trim(),
        days: Number.isFinite(daysArr[i]) && daysArr[i] > 0 ? daysArr[i] : 30,
      });
    });
    if (!undertakings.length) return { error: "A conditional approval needs at least one undertaking." };
  }

  // A deficiency is a task with a deadline, not a vague "revert".
  let deficiency: { title: string; description: string; days: number } | null = null;
  if (action === "REVERT") {
    const days = Number(formData.get("deficiencyDays") ?? 15);
    deficiency = {
      title: String(formData.get("deficiencyTitle") ?? "").trim() || "Deficiency raised during scrutiny",
      description: reason ?? "",
      days: Number.isFinite(days) && days > 0 ? days : 15,
    };
  }

  const now = new Date();
  const nextSla = slas[result.toStage];
  const terminal = result.terminal;

  await db.$transaction(async (tx) => {
    await tx.application.update({
      where: { id: app.id },
      data: {
        currentStage: result.toStage,
        status: result.newStatus,
        stageEnteredAt: now,
        dueAt: terminal ? null : addDays(now, nextSla ?? 7),
        escalationLevel: 0, // entering a new stage resets the SLA clock
        remindedTiers: toJson([]),
        decidedAt: terminal ? now : null,
        decisionNote: terminal ? (reason ?? null) : null,
      },
    });

    await tx.stageTransition.create({
      data: {
        applicationId: app.id,
        fromStage: app.currentStage,
        toStage: result.toStage,
        action,
        actorName: user.name,
        actorRole: user.role,
        reason: reason ?? null,
      },
    });

    // Entering the EVC stage auto-creates the inspection task with its own SLA.
    if (result.toStage === "EVC") {
      const existing = await tx.evcVisit.findUnique({ where: { applicationId: app.id } });
      if (!existing) {
        await tx.evcVisit.create({
          data: { applicationId: app.id, status: "QUEUED", dueAt: addDays(now, nextSla ?? 21) },
        });
      }
    }

    for (const u of undertakings) {
      await tx.undertaking.create({
        data: {
          title: u.title,
          description: u.description,
          phase: "POST",
          dueAt: addDays(now, u.days),
          status: "PENDING",
          institutionId: app.institutionId,
          applicationId: app.id,
        },
      });
    }

    if (deficiency) {
      await tx.undertaking.create({
        data: {
          title: deficiency.title,
          description: deficiency.description,
          phase: "PRE",
          dueAt: addDays(now, deficiency.days),
          status: "PENDING",
          institutionId: app.institutionId,
          applicationId: app.id,
        },
      });
    }
  });

  await audit(user.name, action, "Application", app.id, {
    from: app.currentStage,
    to: result.toStage,
    reason: reason ?? null,
    refNumber: app.refNumber,
  });

  // Feature 1 — trust score events. Advisory only: nothing downstream is
  // triggered by a score change, it merely explains why the number moved.
  if (action === "REJECT") {
    await recordTrustEvent({
      institutionId: app.institutionId,
      applicationId: app.id,
      event: "LOR",
      note: `Letter of rejection issued on ${app.refNumber}${reason ? ` — ${reason}` : ""}`,
    });
  }
  if (deficiency) {
    await recordTrustEvent({
      institutionId: app.institutionId,
      applicationId: app.id,
      event: "DEFICIENCY_ITEM",
      note: deficiency.title,
    });
  }

  // --- notification side-effects
  if (terminal) {
    await notifyInstitution(app.institutionId, {
      type: "DECISION",
      title: `${app.refNumber}: ${result.newStatus.replace(/_/g, " ")}`,
      body: reason ?? "A decision has been recorded by the Competent Authority.",
      link: `/applications/${app.id}`,
    });
    if (result.newStatus === "CONDITIONALLY_APPROVED") {
      await notifyInstitution(app.institutionId, {
        type: "UNDERTAKING_CREATED",
        title: `${undertakings.length} undertaking(s) to comply with`,
        body: "Each condition has its own deadline, reminders and escalation path. Track them under Undertakings.",
        link: `/undertakings`,
      });
    }
    await notifyRole("REGIONAL_OFFICER", {
      type: "DECISION",
      title: `${app.refNumber} decided: ${result.newStatus.replace(/_/g, " ")}`,
      body: `${app.institution.name} — decision recorded by ${user.name}.`,
      link: `/applications/${app.id}`,
    }, app.institution.regionId);
  } else {
    await notifyInstitution(app.institutionId, {
      type: "STAGE_CHANGE",
      title: `${app.refNumber} moved to ${result.toStage.replace(/_/g, " ")}`,
      body: reason ?? "Your application has progressed to the next stage.",
      link: `/applications/${app.id}`,
    });

    const notifyMap: Record<string, string> = {
      RE_SCRUTINY: "SCRUTINY_OFFICER",
      SCRUTINY: "SCRUTINY_OFFICER",
      EVC: "EVC_COORDINATOR",
      COMMITTEE: "COMMITTEE_MEMBER",
      DECISION: "COMPETENT_AUTHORITY",
    };
    const nextRole = notifyMap[result.toStage];
    if (nextRole) {
      await notifyRole(nextRole, {
        type: "STAGE_CHANGE",
        title: `${app.refNumber} awaits ${result.toStage.replace(/_/g, " ")}`,
        body: `${app.institution.name} — SLA ${nextSla ?? 7} day(s).`,
        link: `/applications/${app.id}`,
      }, app.institution.regionId);
    }
  }

  revalidatePath(`/applications/${app.id}`);
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  revalidatePath("/evc");
  revalidatePath("/undertakings");
  revalidatePath("/escalations");

  redirect(`/applications/${app.id}${terminal ? "?tab=timeline" : ""}`);
}

// ---------------------------------------------------------------------------
// Supervisor: assign / re-assign the handling officer
// ---------------------------------------------------------------------------

export async function assignApplication(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["REGIONAL_OFFICER", "BUREAU_OFFICER", "SYSTEM_ADMIN", "SCRUTINY_OFFICER"].includes(user.role)) {
    return { error: "You are not permitted to assign cases." };
  }

  const applicationId = String(formData.get("applicationId") ?? "");
  const assignedToId = String(formData.get("assignedToId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
  if (!assignedToId) {
    await db.application.update({ where: { id: app.id }, data: { assignedToId: null } });
    await audit(user.name, "UNASSIGN", "Application", app.id, { reason: reason || null });
    revalidatePath(`/applications/${app.id}`);
    revalidatePath("/applications");
    return { ok: true };
  }

  const officer = await db.user.findUnique({ where: { id: assignedToId } });
  if (!officer) return { error: "Officer not found." };

  // Feature 5 — going past an officer's cap is allowed, but never silently.
  const ownerRole = (STAGES[app.currentStage as StageKey]?.owner as string) ?? "SCRUTINY_OFFICER";
  const active = await activeCaseCount(officer.id, ownerRole);
  const overCap = active >= (officer.maxActiveCases || DEFAULT_MAX_ACTIVE_CASES);
  if (overCap && !reason) {
    return {
      error: `${officer.name} is carrying ${active} active case(s) — at their cap of ${officer.maxActiveCases}. Record a reason to assign anyway.`,
    };
  }

  await db.application.update({ where: { id: app.id }, data: { assignedToId: officer.id } });

  await notifyUser(officer.id, {
    type: "ASSIGNED",
    title: `${app.refNumber} assigned to you`,
    body: overCap
      ? `${app.programName || app.type} — assigned by ${user.name} over the workload cap: ${reason}`
      : `${app.programName || app.type} — assigned by ${user.name}.`,
    link: `/applications/${app.id}`,
  });

  await audit(user.name, "ASSIGN", "Application", app.id, { assignedTo: officer.name });
  if (overCap) {
    await audit(user.name, "OVERRIDE_ASSIGNMENT", "Application", app.id, {
      assignedTo: officer.name,
      activeCases: active,
      cap: officer.maxActiveCases,
      reason,
    });
  }
  revalidatePath(`/applications/${app.id}`);
  revalidatePath("/applications");
  return { ok: true };
}
