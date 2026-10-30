/**
 * Feature 7 — the chatbot's read-only tool belt.
 *
 * Every tool:
 *  • resolves the caller with getUser(), so an institution can never see another
 *    institution's data and a regional officer never sees another region's;
 *  • only reads — nothing here can transition, approve, reject or suspend;
 *  • returns "I don't have that information."-friendly empty results rather than
 *    guessing.
 */

import { db } from "./db";
import { getUser } from "./session";
import { scopeFor } from "./rbac";
import { daysUntil, fmtDate } from "./time";
import { parseStringArray } from "./json";
import { getTrustBreakdown } from "./trust";
import { stageShort } from "./workflow";

export type ToolResult = { ok: boolean; data?: unknown; message: string };

const NATIONAL = ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"];

/** Every tool starts here: who is asking, and what may they see? */
async function who() {
  const user = await getUser();
  if (!user) return null;
  return { user, appWhere: scopeFor(user) };
}

// ---------------------------------------------------------------------------

export async function getApplicationStatus(args: { refNumber: string }): Promise<ToolResult> {
  const ctx = await who();
  if (!ctx) return { ok: false, message: "No authenticated session." };

  const app = await db.application.findFirst({
    where: { ...ctx.appWhere, refNumber: { contains: args.refNumber, mode: "insensitive" } },
    include: {
      institution: { select: { name: true, city: true, trustScore: true } },
      assignedTo: { select: { name: true } },
      evcVisit: { select: { status: true, scheduledFor: true } },
    },
  });
  if (!app) return { ok: false, message: `No application matching "${args.refNumber}" is visible to you.` };

  const route = parseStringArray(app.routeSnapshot);
  return {
    ok: true,
    data: {
      refNumber: app.refNumber,
      stage: stageShort(app.currentStage),
      status: app.status,
      institution: app.institution.name,
      city: app.institution.city,
      trustScore: app.institution.trustScore,
      route: route.join(" → "),
      assignedTo: app.assignedTo?.name ?? "unassigned",
      dueAt: app.dueAt ? fmtDate(app.dueAt) : null,
      daysLeft: app.dueAt ? daysUntil(app.dueAt) : null,
      evc: app.evcVisit ? { status: app.evcVisit.status, scheduledFor: app.evcVisit.scheduledFor ? fmtDate(app.evcVisit.scheduledFor) : null } : null,
      link: `/applications/${app.id}`,
    },
    message: `Application ${app.refNumber} is at ${stageShort(app.currentStage)}.`,
  };
}

export async function listPendingCases(args: { limit?: number }): Promise<ToolResult> {
  const ctx = await who();
  if (!ctx) return { ok: false, message: "No authenticated session." };

  const apps = await db.application.findMany({
    where: { ...ctx.appWhere, status: { in: ["IN_PROGRESS", "AWAITING_INSTITUTION"] } },
    include: { institution: { select: { name: true } } },
    orderBy: { dueAt: "asc" },
    take: Math.min(args.limit ?? 10, 25),
  });

  return {
    ok: true,
    data: apps.map((a) => ({
      refNumber: a.refNumber,
      institution: a.institution.name,
      stage: stageShort(a.currentStage),
      status: a.status,
      daysLeft: a.dueAt ? daysUntil(a.dueAt) : null,
      link: `/applications/${a.id}`,
    })),
    message: `${apps.length} case(s) in progress.`,
  };
}

export async function getExpiringDocuments(args: { withinDays?: number }): Promise<ToolResult> {
  const ctx = await who();
  if (!ctx) return { ok: false, message: "No authenticated session." };
  const within = args.withinDays ?? 90;

  const where: Record<string, unknown> =
    ctx.user.role === "INSTITUTION"
      ? { institutionId: ctx.user.institutionId ?? "__none__" }
      : NATIONAL.includes(ctx.user.role)
        ? {}
        : { institution: { regionId: ctx.user.regionId ?? "__none__" } };

  const docs = await db.document.findMany({
    where,
    include: { institution: { select: { name: true } } },
    orderBy: { expiresAt: "asc" },
  });

  const hits = docs.filter((d) => daysUntil(d.expiresAt) <= within);
  return {
    ok: true,
    data: hits.slice(0, 25).map((d) => ({
      type: d.type.replace(/_/g, " "),
      institution: d.institution.name,
      expiresAt: fmtDate(d.expiresAt),
      daysLeft: daysUntil(d.expiresAt),
      status: d.status,
      link: "/documents",
    })),
    message: `${hits.length} document(s) expiring within ${within} days.`,
  };
}

export async function getUndertakings(args: { status?: string }): Promise<ToolResult> {
  const ctx = await who();
  if (!ctx) return { ok: false, message: "No authenticated session." };

  const where: Record<string, unknown> =
    ctx.user.role === "INSTITUTION"
      ? { institutionId: ctx.user.institutionId ?? "__none__" }
      : NATIONAL.includes(ctx.user.role)
        ? {}
        : { institution: { regionId: ctx.user.regionId ?? "__none__" } };
  if (args.status) where.status = args.status;

  const rows = await db.undertaking.findMany({
    where,
    include: { institution: { select: { name: true } } },
    orderBy: { dueAt: "asc" },
    take: 25,
  });

  return {
    ok: true,
    data: rows.map((u) => ({
      title: u.title,
      institution: u.institution.name,
      phase: u.phase === "PRE" ? "Deficiency" : "Condition of approval",
      status: u.status,
      daysLeft: daysUntil(u.dueAt),
      dueAt: fmtDate(u.dueAt),
      link: `/institution/respond/${u.id}`,
    })),
    message: `${rows.length} undertaking(s).`,
  };
}

export async function getTrustScore(args: { institutionName?: string }): Promise<ToolResult> {
  const ctx = await who();
  if (!ctx) return { ok: false, message: "No authenticated session." };

  let institutionId: string | null = null;
  if (ctx.user.role === "INSTITUTION") {
    institutionId = ctx.user.institutionId;
  } else if (args.institutionName) {
    const inst = await db.institution.findFirst({ where: { name: { contains: args.institutionName, mode: "insensitive" } }, select: { id: true } });
    institutionId = inst?.id ?? null;
  }
  if (!institutionId) return { ok: false, message: "Name the institution you want the trust score for." };

  const breakdown = await getTrustBreakdown(institutionId, 10);
  if (!breakdown) return { ok: false, message: "Institution not found." };

  return {
    ok: true,
    data: {
      institution: breakdown.institution.name,
      score: breakdown.score,
      contributions: breakdown.byType,
      recentEvents: breakdown.events.slice(0, 5),
      note: "The trust score is advisory. It never suspends, penalises or rejects on its own.",
    },
    message: `${breakdown.institution.name} has a compliance trust score of ${breakdown.score}/100.`,
  };
}

/**
 * Plain-language explanation of a deficiency: what was asked, why, and what
 * evidence will satisfy it. Advisory — always ends with the official-interpretation caveat.
 */
export async function explainDeficiency(args: { undertakingId?: string; title?: string }): Promise<ToolResult> {
  const ctx = await who();
  if (!ctx) return { ok: false, message: "No authenticated session." };

  const where: Record<string, unknown> = {};
  if (args.undertakingId) where.id = args.undertakingId;
  else if (args.title) where.title = { contains: args.title, mode: "insensitive" };
  else return { ok: false, message: "Give me the deficiency title or id." };

  const whereScoped =
    ctx.user.role === "INSTITUTION"
      ? { ...where, institutionId: ctx.user.institutionId ?? "__none__" }
      : NATIONAL.includes(ctx.user.role)
        ? where
        : { ...where, institution: { regionId: ctx.user.regionId ?? "__none__" } };

  const u = await db.undertaking.findFirst({
    where: whereScoped,
    include: { institution: { select: { name: true } }, submissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
  });
  if (!u) return { ok: false, message: "No such deficiency is visible to you." };

  const evidence = u.description
    .split(/(?<=[.;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);

  return {
    ok: true,
    data: {
      title: u.title,
      institution: u.institution.name,
      phase: u.phase === "PRE" ? "Deficiency raised during processing" : "Condition of approval",
      plainLanguage: `AICTE has asked ${u.institution.name} to satisfy: ${u.title}. ${u.description}`,
      evidenceChecklist: evidence.length ? evidence : [`Upload proof for: ${u.title}`],
      dueAt: fmtDate(u.dueAt),
      daysLeft: daysUntil(u.dueAt),
      status: u.status,
      lastSubmission: u.submissions[0]?.fileName ?? null,
      clause: "Approval Process Handbook — deficiency compliance (see the route's SLA snapshot for the exact clock)",
      link: `/institution/respond/${u.id}`,
      disclaimer: "This is AI assistance; official interpretation rests with AICTE.",
    },
    message: u.title,
  };
}

export async function searchAuditLog(args: { entityType?: string; entityId?: string; limit?: number }): Promise<ToolResult> {
  const ctx = await who();
  if (!ctx) return { ok: false, message: "No authenticated session." };
  if (!NATIONAL.includes(ctx.user.role) && !["REGIONAL_OFFICER", "INSTITUTION"].includes(ctx.user.role)) {
    return { ok: false, message: "Your role cannot search the audit log." };
  }

  const where: Record<string, unknown> = {};
  if (args.entityType) where.entityType = args.entityType;
  if (args.entityId) where.entityId = args.entityId;

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(args.limit ?? 10, 30),
  });

  return {
    ok: true,
    data: rows.map((r) => {
      let meta: unknown = r.metadata;
      try {
        meta = JSON.parse(r.metadata);
      } catch {
        /* keep raw string */
      }
      return { action: r.action, entityType: r.entityType, entityId: r.entityId, actor: r.actorName, at: fmtDate(r.createdAt), meta };
    }),
    message: `${rows.length} audit entr(y/ies).`,
  };
}
