"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notifyInstitution, notifyRole, notifyUser } from "@/lib/notify";
import { toJson } from "@/lib/json";
import type { ActionState } from "./application";

// ---------------------------------------------------------------------------
// EVC Coordinator constitutes and schedules the visit
// ---------------------------------------------------------------------------

export async function scheduleEvc(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["EVC_COORDINATOR", "REGIONAL_OFFICER", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "Only the EVC coordinator can schedule a visit." };
  }

  const evcId = String(formData.get("evcId") ?? "");
  const scheduledRaw = String(formData.get("scheduledFor") ?? "").trim();
  const members = formData.getAll("members").map(String).filter(Boolean);
  const visitMode = String(formData.get("visitMode") ?? "PHYSICAL");

  if (!scheduledRaw) return { error: "Choose the date of the visit." };
  const scheduledFor = new Date(scheduledRaw);
  if (Number.isNaN(scheduledFor.getTime())) return { error: "That date could not be read." };
  if (scheduledFor.getTime() < Date.now()) return { error: "The visit cannot be scheduled in the past." };

  const evc = await db.evcVisit.findUnique({
    where: { id: evcId },
    include: { application: { select: { id: true, refNumber: true, regionId: true, institutionId: true, institution: { select: { name: true } } } } },
  });
  if (!evc) return { error: "Visit not found." };

  // store human-readable panel names, keep ids for notification targeting
  const panelUsers = await db.user.findMany({ where: { id: { in: members } }, select: { id: true, name: true } });
  const panelNames = panelUsers.map((p) => p.name);

  await db.evcVisit.update({
    where: { id: evc.id },
    data: {
      status: "SCHEDULED",
      scheduledFor,
      members: toJson(panelNames.length ? panelNames : ["To be constituted"]),
    },
  });

  await audit(user.name, "EVC_SCHEDULED", "EvcVisit", evc.id, {
    scheduledFor: scheduledFor.toISOString(),
    members,
    visitMode,
    refNumber: evc.application.refNumber,
  });

  await notifyInstitution(evc.application.institutionId, {
    type: "EVC_SCHEDULED",
    title: `Expert Visit scheduled for ${evc.application.refNumber}`,
    body: `${scheduledFor.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} — ${visitMode.toLowerCase()} inspection by ${members.length || 0} expert(s).`,
    link: `/applications/${evc.application.id}`,
  });

  for (const m of panelUsers) {
    await notifyUser(m.id, {
      type: "EVC_PANEL",
      title: `You are on the EVC panel for ${evc.application.refNumber}`,
      body: `${evc.application.institution.name} — visit on ${scheduledFor.toLocaleDateString("en-IN", { dateStyle: "medium" })}.`,
      link: `/evc/${evc.id}`,
    });
  }

  await notifyRole("REGIONAL_OFFICER", {
    type: "EVC_SCHEDULED",
    title: `EVC scheduled: ${evc.application.refNumber}`,
    body: `${evc.application.institution.name} — ${scheduledFor.toLocaleDateString("en-IN", { dateStyle: "medium" })}.`,
    link: `/evc/${evc.id}`,
  }, evc.application.regionId);

  revalidatePath(`/evc/${evc.id}`);
  revalidatePath("/evc");
  revalidatePath(`/applications/${evc.application.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Expert files the inspection report
// ---------------------------------------------------------------------------

export async function fileEvcReport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["EVC_COORDINATOR", "EVC_MEMBER", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "Only the visiting committee can file the inspection report." };
  }

  const evcId = String(formData.get("evcId") ?? "");
  const reportText = String(formData.get("reportText") ?? "").trim();
  const recommendation = String(formData.get("recommendation") ?? "SATISFACTORY");

  if (reportText.length < 20) return { error: "Write a short inspection note (at least 20 characters)." };

  const evc = await db.evcVisit.findUnique({
    where: { id: evcId },
    include: { application: { select: { id: true, refNumber: true, regionId: true, institutionId: true, institution: { select: { name: true } } } } },
  });
  if (!evc) return { error: "Visit not found." };

  await db.evcVisit.update({
    where: { id: evc.id },
    data: { status: "COMPLETED", reportText, recommendation, completedAt: new Date() },
  });

  await audit(user.name, "EVC_REPORT_FILED", "EvcVisit", evc.id, {
    recommendation,
    refNumber: evc.application.refNumber,
  });

  await notifyRole("EVC_COORDINATOR", {
    type: "EVC_REPORT",
    title: `Report filed: ${evc.application.refNumber} (${recommendation})`,
    body: `${user.name} submitted the inspection note. You may now close the EVC stage.`,
    link: `/applications/${evc.application.id}`,
  }, evc.application.regionId);

  if (recommendation === "DEFICIENT") {
    await notifyRole("REGIONAL_OFFICER", {
      type: "EVC_DEFICIENT",
      title: `EVC found deficiencies: ${evc.application.refNumber}`,
      body: `${evc.application.institution.name} — the case will be reverted to the institution.`,
      link: `/applications/${evc.application.id}`,
    }, evc.application.regionId);
  }

  revalidatePath(`/evc/${evc.id}`);
  revalidatePath("/evc");
  revalidatePath(`/applications/${evc.application.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Feature 4 — confirm an auto-allocated EVC panel
// ---------------------------------------------------------------------------

/**
 * The coordinator reviews the machine proposal, optionally swaps members, and
 * confirms. Only this call writes a panel to the visit.
 */
export async function confirmPanel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["EVC_COORDINATOR", "SYSTEM_ADMIN"].includes(user.role)) {
    return { error: "Only the EVC coordinator can allocate a panel." };
  }

  const visitId = String(formData.get("visitId") ?? "");
  const selectionsJson = String(formData.get("selections") ?? "[]");

  const visit = await db.evcVisit.findUnique({
    where: { id: visitId },
    include: {
      application: {
        select: {
          id: true,
          refNumber: true,
          institution: { select: { id: true, name: true, city: true, state: true } },
        },
      },
    },
  });
  if (!visit) return { error: "Visit not found." };

  let selections: { slot: string; expertId: string; score?: number; reasons?: string[] }[] = [];
  try {
    selections = JSON.parse(selectionsJson) as typeof selections;
  } catch {
    return { error: "The panel selection could not be read." };
  }
  if (!selections.length) return { error: "Select an expert for every panel slot." };

  const expertIds = selections.map((s) => s.expertId);
  const experts = await db.expert.findMany({ where: { id: { in: expertIds } } });
  if (experts.length !== expertIds.length) return { error: "One of the selected experts is no longer empanelled." };
  if (new Set(expertIds).size !== expertIds.length) return { error: "The same expert cannot fill two slots." };

  const byId = new Map(experts.map((e) => [e.id, e]));
  const panel = selections.map((s) => {
    const e = byId.get(s.expertId)!;
    return {
      id: e.id,
      name: e.name,
      designation: e.designation,
      role: s.slot === "CHAIR" ? "Chairperson" : s.slot === "MEMBER_TECHNICAL" ? "Technical member" : "Academic member",
      score: s.score ?? null,
      reasons: s.reasons ?? [],
      confirmedBy: user.name,
    };
  });

  await db.evcVisit.update({
    where: { id: visit.id },
    data: {
      experts: toJson(panel),
      allocatedAt: new Date(),
      allocatedBy: user.name,
      members: toJson(panel.map((p) => p.name)),
    },
  });

  await audit(user.name, "EVC_PANEL_ALLOCATED", "EvcVisit", visit.id, {
    refNumber: visit.application.refNumber,
    panel: panel.map((p) => ({ name: p.name, role: p.role, score: p.score })),
    engine: "auto-allocation (human confirmed)",
  });

  // Experts who hold a portal account are told directly; the rest are handled
  // outside the system by the coordinating office.
  for (const p of panel) {
    const expert = byId.get(p.id);
    if (!expert?.userId) continue;
    await notifyUser(expert.userId, {
      type: "EVC_PANEL",
      title: `You are on the panel for ${visit.application.refNumber}`,
      body: `${visit.application.institution.name}, ${visit.application.institution.city} — you have been allocated as ${p.role}.`,
      link: `/evc/${visit.id}`,
    });
  }
  const notified = panel.filter((p) => byId.get(p.id)?.userId).length;
  console.log(`[evc] panel confirmed for ${visit.application.refNumber}; ${notified} expert(s) notified`);

  revalidatePath("/evc");
  revalidatePath(`/evc/${visit.id}`);
  revalidatePath("/dashboard");

  return { ok: true };
}
