"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email and password." };

  const user = await db.user.findUnique({ where: { email } });
  if (!user) return { error: "No account found for that email address." };

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { error: "Incorrect password." };

  await createSession(user.id);
  await audit(user.name, "LOGIN", "User", user.id, { role: user.role });
  redirect("/dashboard");
}

export async function logoutAction() {
  const user = await requireUser().catch(() => null);
  if (user) await audit(user.name, "LOGOUT", "User", user.id, {});
  await destroySession();
  redirect("/login");
}
