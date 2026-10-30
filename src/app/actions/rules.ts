"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { toJson } from "@/lib/json";
import { simulatePublish, templateAppTypes, validateTemplate, type RouteTemplateLike } from "@/lib/workflow";
import type { ActionState } from "./application";

const STAGE_ORDER = ["SCRUTINY", "EVC", "COMMITTEE", "DECISION"];

function readFormTemplate(formData: FormData) {
  const stages = STAGE_ORDER.filter((s) => formData.get(`stage_${s}`) === "on");
  const slaDays: Record<string, number> = {};
  for (const s of stages) {
    const v = Number(formData.get(`sla_${s}`) ?? 0);
    slaDays[s] = Number.isFinite(v) && v > 0 ? v : 1;
  }

  const appTypes = ["NEW_INSTITUTION", "RENEWAL", "EXTENSION_INTAKE", "NEW_COURSE"].filter(
    (t) => formData.get(`type_${t}`) === "on",
  );
  const institutionTypes = ["NEW", "EXISTING"].filter((t) => formData.get(`inst_${t}`) === "on");

  return {
    key: String(formData.get("key") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    changeNote: String(formData.get("changeNote") ?? "").trim() || null,
    stages: toJson(stages),
    slaDays: toJson(slaDays),
    appTypes: toJson(appTypes),
    institutionTypes: toJson(institutionTypes),
  };
}

function guard(userRole: string) {
  return userRole === "POLICY_ADMIN" || userRole === "SYSTEM_ADMIN"
    ? null
    : "Only a policy administrator may change approval-process rules.";
}

// ---------------------------------------------------------------------------
// Create a new draft rule
// ---------------------------------------------------------------------------

export async function createRuleDraft(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const denied = guard(user.role);
  if (denied) return { error: denied };

  const key = String(formData.get("key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!key || !name) return { error: "A route key and name are required." };

  const existing = await db.routeTemplate.findFirst({ where: { key }, orderBy: { version: "desc" } });
  const version = (existing?.version ?? 0) + 1;

  const t = await db.routeTemplate.create({
    data: {
      key,
      name,
      version,
      status: "DRAFT",
      stages: toJson(["SCRUTINY", "DECISION"]),
      slaDays: toJson({ SCRUTINY: 7, DECISION: 10 }),
      appTypes: toJson([]),
      institutionTypes: toJson([]),
    },
  });

  await audit(user.name, "RULE_DRAFT_CREATED", "RouteTemplate", t.id, { key, name, version });
  redirect(`/admin/rules/${t.id}`);
}

// ---------------------------------------------------------------------------
// Save edits to a draft
// ---------------------------------------------------------------------------

export async function saveRuleDraft(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const denied = guard(user.role);
  if (denied) return { error: denied };

  const id = String(formData.get("id") ?? "");
  const t = await db.routeTemplate.findUnique({ where: { id } });
  if (!t) return { error: "Rule not found." };
  if (t.status !== "DRAFT") return { error: "A published rule cannot be edited. Create a new version instead." };

  const data = readFormTemplate(formData);
  await db.routeTemplate.update({ where: { id }, data });
  await audit(user.name, "RULE_DRAFT_SAVED", "RouteTemplate", id, data as unknown as Record<string, unknown>);

  revalidatePath(`/admin/rules/${id}`);
  revalidatePath("/admin/rules");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Publish (with validation, conflict detection and impact simulation)
// ---------------------------------------------------------------------------

export async function publishRule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const denied = guard(user.role);
  if (denied) return { error: denied };

  const id = String(formData.get("id") ?? "");
  const draft = await db.routeTemplate.findUnique({ where: { id } });
  if (!draft) return { error: "Rule not found." };
  if (draft.status === "PUBLISHED") return { error: "This version is already published." };

  // re-validate server-side: the UI can be bypassed, the rule engine cannot
  const { errors } = validateTemplate(draft);
  if (errors.length) return { error: `Cannot publish — ${errors[0]}` };

  const published = await db.routeTemplate.findMany({ where: { status: "PUBLISHED" } });
  const inflight = await db.application
    .findMany({
      where: { status: { in: ["IN_PROGRESS", "AWAITING_INSTITUTION"] } },
      select: { id: true, refNumber: true, currentStage: true, routeKey: true, routeSnapshot: true },
    })
    .then((rows) => rows.map((r) => ({ ...r, routeSnapshot: r.routeSnapshot })));

  const sim = simulatePublish({
    candidate: draft as RouteTemplateLike,
    published: published as RouteTemplateLike[],
    inflight: inflight.map(({ routeSnapshot, ...rest }) => ({ ...rest, routeSnapshot })),
  });
  if (sim.conflicts.length) return { error: `Cannot publish — ${sim.conflicts[0]}` };

  await db.$transaction([
    // archive the previous live version of this route
    db.routeTemplate.updateMany({
      where: { key: draft.key, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    }),
    db.routeTemplate.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        publishedBy: user.name,
      },
    }),
  ]);

  await audit(user.name, "RULE_PUBLISHED", "RouteTemplate", id, {
    key: draft.key,
    version: draft.version,
    stages: draft.stages,
    slaDays: draft.slaDays,
    appTypes: templateAppTypes(draft),
    note: draft.changeNote,
  });

  revalidatePath("/admin/rules");
  revalidatePath(`/admin/rules/${id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Archive / duplicate-as-new-version
// ---------------------------------------------------------------------------

export async function archiveRule(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "POLICY_ADMIN" && user.role !== "SYSTEM_ADMIN") return;

  const id = String(formData.get("id") ?? "");
  await db.routeTemplate.update({ where: { id }, data: { status: "ARCHIVED" } });
  await audit(user.name, "RULE_ARCHIVED", "RouteTemplate", id, {});
  revalidatePath("/admin/rules");
}

export async function newVersionRule(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "POLICY_ADMIN" && user.role !== "SYSTEM_ADMIN") return;

  const id = String(formData.get("id") ?? "");
  const src = await db.routeTemplate.findUnique({ where: { id } });
  if (!src) return;

  const latest = await db.routeTemplate.findFirst({ where: { key: src.key }, orderBy: { version: "desc" } });
  const t = await db.routeTemplate.create({
    data: {
      key: src.key,
      name: src.name,
      version: (latest?.version ?? src.version) + 1,
      status: "DRAFT",
      stages: src.stages,
      slaDays: src.slaDays,
      appTypes: src.appTypes,
      institutionTypes: src.institutionTypes,
      changeNote: `Cloned from v${src.version}`,
    },
  });

  await audit(user.name, "RULE_VERSION_CREATED", "RouteTemplate", t.id, { from: src.id, version: t.version });
  redirect(`/admin/rules/${t.id}`);
}
