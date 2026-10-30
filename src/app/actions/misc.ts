"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import type { ActionState } from "./application";

export async function markAllReadAction() {
  const user = await requireUser();
  await db.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
  revalidatePath("/notifications");
}

export async function markReadAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  await db.notification.updateMany({ where: { id, userId: user.id }, data: { read: true } });
  revalidatePath("/notifications");
}

export async function resolveEscalationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!["REGIONAL_OFFICER", "BUREAU_OFFICER", "COMPLIANCE_OFFICER", "SYSTEM_ADMIN", "POLICY_ADMIN"].includes(user.role)) {
    return { error: "You cannot close an escalation." };
  }

  const id = String(formData.get("escalationId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const esc = await db.escalation.findUnique({ where: { id } });
  if (!esc) return { error: "Escalation not found." };

  await db.escalation.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: user.name },
  });

  await audit(user.name, "ESCALATION_RESOLVED", "Escalation", id, {
    entityType: esc.entityType,
    level: esc.level,
    note,
  });

  revalidatePath("/escalations");
  revalidatePath("/dashboard");
  return { ok: true };
}
