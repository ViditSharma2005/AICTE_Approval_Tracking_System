"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { DEFAULT_PASSWORD, ROLES } from "@/lib/constants";
import type { ActionState } from "./application";

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "SYSTEM_ADMIN") return { error: "Only the system administrator can create users." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const regionId = String(formData.get("regionId") ?? "") || null;
  const institutionId = String(formData.get("institutionId") ?? "") || null;
  const password = String(formData.get("password") ?? DEFAULT_PASSWORD);

  if (!email || !name) return { error: "Name and email are required." };
  if (!ROLES.includes(role as (typeof ROLES)[number])) return { error: "Select a valid role." };
  if (await db.user.findUnique({ where: { email } })) return { error: "That email is already registered." };

  const created = await db.user.create({
    data: { email, name, role, regionId, institutionId, passwordHash: await bcrypt.hash(password, 10) },
  });

  await audit(user.name, "USER_CREATED", "User", created.id, { email, role });
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "SYSTEM_ADMIN") return { error: "Only the system administrator can reset passwords." };

  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? DEFAULT_PASSWORD) || DEFAULT_PASSWORD;

  await db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  await audit(user.name, "PASSWORD_RESET", "User", id, {});
  revalidatePath("/admin/users");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Feature 5 — officer workload cap
// ---------------------------------------------------------------------------

export async function setWorkloadCap(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "SYSTEM_ADMIN") return { error: "Only the system administrator can change workload caps." };

  const id = String(formData.get("id") ?? "");
  const cap = Number(formData.get("maxActiveCases"));
  if (!id) return { error: "User missing." };
  if (!Number.isFinite(cap) || cap < 1 || cap > 100) return { error: "Enter a cap between 1 and 100." };

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return { error: "User not found." };

  await db.user.update({ where: { id }, data: { maxActiveCases: Math.round(cap) } });
  await audit(user.name, "SET_WORKLOAD_CAP", "User", id, { name: target.name, from: target.maxActiveCases, to: Math.round(cap) });

  revalidatePath("/admin/users");
  revalidatePath("/dashboard");
  return { ok: true };
}
