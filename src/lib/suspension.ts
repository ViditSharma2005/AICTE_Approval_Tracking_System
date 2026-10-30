/**
 * Feature 8 — the ONLY path to suspending an institution.
 *
 * Everything here is deliberately explicit: a recommendation record, a named
 * human authority, a recorded reason. The engine may raise the recommendation,
 * but only the Competent Authority's approval changes an institution's status.
 */

import { db } from "./db";
import { audit } from "./audit";
import { notifyInstitution } from "./notify";

export type DecisionResult = { ok: boolean; error?: string; institutionName?: string };

export async function decideSuspension(args: {
  taskId: string;
  decision: "APPROVED" | "REJECTED";
  note: string;
  actorName: string;
}): Promise<DecisionResult> {
  const task = await db.task.findUnique({ where: { id: args.taskId } });
  if (!task) return { ok: false, error: "Recommendation not found." };
  if (task.type !== "SUSPENSION_RECOMMENDATION") return { ok: false, error: "This is not a suspension recommendation." };
  if (task.status !== "OPEN") return { ok: false, error: "This recommendation has already been decided." };
  if (!args.note.trim()) return { ok: false, error: "Record the reasoning behind your decision." };

  await db.task.update({
    where: { id: task.id },
    data: { status: args.decision, decidedBy: args.actorName, decidedAt: new Date(), decisionNote: args.note },
  });

  let institutionName: string | undefined;
  if (args.decision === "APPROVED" && task.institutionId) {
    const inst = await db.institution.update({ where: { id: task.institutionId }, data: { status: "SUSPENDED" } });
    institutionName = inst.name;
  } else if (task.institutionId) {
    const inst = await db.institution.findUnique({ where: { id: task.institutionId }, select: { name: true } });
    institutionName = inst?.name;
  }

  await audit(args.actorName, args.decision === "APPROVED" ? "SUSPENSION_APPROVED" : "SUSPENSION_REJECTED", "Task", task.id, {
    institutionId: task.institutionId,
    institution: institutionName ?? null,
    entityType: task.entityType,
    entityId: task.entityId,
    note: args.note,
  });

  if (task.institutionId) {
    await notifyInstitution(task.institutionId, {
      type: args.decision === "APPROVED" ? "SUSPENSION_APPROVED" : "SUSPENSION_REJECTED",
      title: args.decision === "APPROVED" ? "Approval suspended" : "Suspension recommendation not accepted",
      body:
        args.decision === "APPROVED"
          ? `The Competent Authority (${args.actorName}) has accepted the suspension recommendation. Reason: ${args.note}`
          : `The Competent Authority (${args.actorName}) did not accept the recommendation. Reason: ${args.note}`,
      link: "/dashboard",
    });
  }

  return { ok: true, institutionName };
}
