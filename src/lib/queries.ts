import { db } from "./db";
import type { SessionUser } from "./session";
import { scopeFor } from "./rbac";
import { AGEING_BUCKETS } from "./constants";
import { daysBetween, daysSince, daysUntil, addDays } from "./time";
import { parseNumberArray, parseStringArray } from "./json";
import { priorityScore, type PriorityResult } from "./priority";

export const APPLICATION_INCLUDE = {
  institution: { select: { id: true, name: true, aisheCode: true, city: true, type: true, trustScore: true } },
  region: { select: { id: true, name: true, code: true } },
  assignedTo: { select: { id: true, name: true, role: true } },
  evcVisit: true,
  undertakings: { select: { id: true, status: true, phase: true } },
} as const;

export type ApplicationRow = Awaited<ReturnType<typeof getApplications>>["rows"][number];

// ---------------------------------------------------------------------------
// Everything one role is allowed to see, in one pass (small prototype dataset)
// ---------------------------------------------------------------------------

export async function getScopedData(user: SessionUser) {
  const appWhere = scopeFor(user);
  const instWhere =
    user.role === "INSTITUTION"
      ? { id: user.institutionId ?? "__none__" }
      : ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
        ? {}
        : { regionId: user.regionId ?? "__none__" };

  const [rawApplications, undertakings, documents, escalations, notifications, officers, regions, institutions, users] =
    await Promise.all([
      db.application.findMany({
        where: appWhere,
        include: APPLICATION_INCLUDE,
        orderBy: { submittedAt: "desc" },
      }),
      db.undertaking.findMany({
        where:
          user.role === "INSTITUTION"
            ? { institutionId: user.institutionId ?? "__none__" }
            : ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
              ? {}
              : { institution: { regionId: user.regionId ?? "__none__" } },
        include: {
          institution: { select: { id: true, name: true, regionId: true, trustScore: true } },
          application: { select: { id: true, refNumber: true } },
          submissions: { orderBy: { submittedAt: "desc" } },
        },
        orderBy: { dueAt: "asc" },
      }),
      db.document.findMany({
        where:
          user.role === "INSTITUTION"
            ? { institutionId: user.institutionId ?? "__none__" }
            : ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
              ? {}
              : { institution: { regionId: user.regionId ?? "__none__" } },
        include: { institution: { select: { id: true, name: true, regionId: true, trustScore: true } } },
        orderBy: { expiresAt: "asc" },
      }),
      db.escalation.findMany({
        where: user.role === "INSTITUTION" ? { id: "__none__" } : {},
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 200,
      }),
      db.notification.findMany({
        where: { userId: user.id },
        orderBy: [{ read: "asc" }, { createdAt: "desc" }],
        take: 12,
      }),
      db.user.findMany({
        where: {
          role: { in: ["SCRUTINY_OFFICER", "COMPLIANCE_OFFICER"] },
          ...(user.regionId && !["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
            ? { regionId: user.regionId }
            : {}),
        },
        select: { id: true, name: true, role: true, regionId: true },
      }),
      db.region.findMany({ orderBy: { name: "asc" } }),
      db.institution.findMany({ where: instWhere, select: { id: true, name: true, city: true, regionId: true, trustScore: true } }),
      db.user.findMany({ select: { id: true, name: true, email: true, role: true, regionId: true, institutionId: true } }),
    ]);

  // Escalations are region-scoped for regional roles: resolve by entity ids we can see.
  let visibleEscalations = escalations;
  if (
    !["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN"].includes(user.role) &&
    user.role !== "INSTITUTION" &&
    user.regionId
  ) {
    const appIds = new Set(rawApplications.map((a) => a.id));
    const undIds = new Set(undertakings.map((u) => u.id));
    const docIds = new Set(documents.map((d) => d.id));
    const all = await db.escalation.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
    visibleEscalations = all.filter(
      (e) =>
        (e.entityType === "APPLICATION" && appIds.has(e.entityId)) ||
        (e.entityType === "UNDERTAKING" && undIds.has(e.entityId)) ||
        (e.entityType === "DOCUMENT" && docIds.has(e.entityId)) ||
        (e.entityType === "EVC" && rawApplications.some((a) => a.evcVisit?.id === e.entityId)),
    );
  }

  // Attach the explainable priority score and SLA state once, for every dashboard.
  const nowDate = new Date();
  const applications = rawApplications.map((a) => ({
    ...a,
    priority: priorityScore({
      dueAt: a.dueAt,
      escalationLevel: a.escalationLevel,
      stageEnteredAt: a.stageEnteredAt,
      evcStatus: a.evcVisit?.status ?? null,
      overdueUndertakings: a.undertakings.filter((u) => u.status === "OVERDUE" || u.status === "ESCALATED").length,
    }),
    overdue: !!a.dueAt && a.dueAt < nowDate,
    ageDays: daysSince(a.submittedAt, nowDate),
  }));

  return {
    applications,
    undertakings,
    documents,
    escalations: visibleEscalations,
    notifications,
    officers,
    regions,
    institutions,
    users,
  };
}

// ---------------------------------------------------------------------------
// Applications list with filters
// ---------------------------------------------------------------------------

export async function getApplications(
  user: SessionUser,
  filters: { q?: string; stage?: string; status?: string; regionId?: string; type?: string; overdue?: boolean; mine?: boolean },
) {
  const where: Record<string, unknown> = { ...scopeFor(user) };

  if (filters.q) {
    where.OR = [
      { refNumber: { contains: filters.q, mode: "insensitive" } },
      { programName: { contains: filters.q, mode: "insensitive" } },
      { institution: { name: { contains: filters.q, mode: "insensitive" } } },
    ];
  }
  if (filters.stage) where.currentStage = filters.stage;
  if (filters.status) where.status = filters.status;
  if (filters.regionId) where.regionId = filters.regionId;
  if (filters.type) where.type = filters.type;
  if (filters.mine && user.role !== "INSTITUTION") where.assignedToId = user.id;

  const rows = await db.application.findMany({
    where,
    include: APPLICATION_INCLUDE,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });

  const now = new Date();
  let list = rows.map((a) => {
    const priority = priorityScore({
      dueAt: a.dueAt,
      escalationLevel: a.escalationLevel,
      stageEnteredAt: a.stageEnteredAt,
      evcStatus: a.evcVisit?.status ?? null,
      overdueUndertakings: a.undertakings.filter((u) => u.status === "OVERDUE" || u.status === "ESCALATED").length,
    });
    return { ...a, priority, overdue: !!a.dueAt && a.dueAt < now, ageDays: daysSince(a.submittedAt, now) };
  });

  if (filters.overdue) list = list.filter((a) => a.overdue);

  // Most urgent first.
  list.sort((a, b) => {
    const open = (s: string) => (["APPROVED", "REJECTED", "CONDITIONALLY_APPROVED"].includes(s) ? 1 : 0);
    if (open(a.status) !== open(b.status)) return open(a.status) - open(b.status);
    return b.priority.score - a.priority.score || b.ageDays - a.ageDays;
  });

  return {
    rows: list,
    total: list.length,
    open: list.filter((a) => !["APPROVED", "REJECTED", "CONDITIONALLY_APPROVED"].includes(a.status)).length,
    overdue: list.filter((a) => a.overdue).length,
  };
}

export type ApplicationListItem = Awaited<ReturnType<typeof getApplications>>["rows"][number];

// ---------------------------------------------------------------------------
// Aggregations used by dashboards and reports
// ---------------------------------------------------------------------------

export function stageMatrix(applications: { currentStage: string; status: string; submittedAt: Date }[]) {
  const stages = ["SCRUTINY", "RE_SCRUTINY", "INSTITUTION_RESPONSE", "EVC", "COMMITTEE", "DECISION"];
  const now = new Date();
  return stages
    .map((s) => {
      const rows = applications.filter((a) => a.currentStage === s && !isDecided(a.status));
      const values: Record<string, number> = {};
      for (const b of AGEING_BUCKETS) values[b.key] = 0;
      for (const r of rows) {
        const age = daysSince(r.submittedAt, now);
        const bucket = AGEING_BUCKETS.find((b) => age >= b.min && age <= b.max) ?? AGEING_BUCKETS.at(-1)!;
        values[bucket.key] += 1;
      }
      return { label: shortStage(s), values };
    })
    .filter((r) => AGEING_BUCKETS.reduce((s, b) => s + (r.values[b.key] ?? 0), 0) > 0 || true);
}

export function regionStats(
  applications: { regionId: string; status: string; dueAt: Date | null; submittedAt: Date }[],
  regions: { id: string; name: string }[],
) {
  const now = new Date();
  return regions.map((r) => {
    const mine = applications.filter((a) => a.regionId === r.id);
    const open = mine.filter((a) => !isDecided(a.status));
    const overdue = open.filter((a) => a.dueAt && a.dueAt < now);
    const decided = mine.filter((a) => isDecided(a.status));
    const avgPendency = open.length
      ? Math.round(open.reduce((s, a) => s + daysSince(a.submittedAt, now), 0) / open.length)
      : 0;
    return {
      id: r.id,
      name: r.name,
      total: mine.length,
      open: open.length,
      overdue: overdue.length,
      decided: decided.length,
      avgPendency,
      complianceRate: open.length + decided.length ? Math.round((decided.length / mine.length) * 100) : 0,
    };
  });
}

export function workloadByOfficer(
  applications: { assignedTo: { id: string; name: string } | null; status: string; dueAt: Date | null }[],
  officers: { id: string; name: string }[],
) {
  const now = new Date();
  return officers
    .map((o) => {
      const mine = applications.filter((a) => a.assignedTo?.id === o.id && !isDecided(a.status));
      return {
        id: o.id,
        name: o.name,
        open: mine.length,
        overdue: mine.filter((a) => a.dueAt && a.dueAt < now).length,
      };
    })
    .sort((a, b) => b.open - a.open);
}

export function trend(
  applications: { submittedAt: Date; decidedAt: Date | null }[],
  periods = 8,
) {
  const now = new Date();
  const labels: string[] = [];
  const submitted: number[] = [];
  const decided: number[] = [];

  for (let i = periods - 1; i >= 0; i--) {
    const start = addDays(now, -i);
    const end = addDays(now, -i + 1);
    labels.push(
      start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    );
    submitted.push(applications.filter((a) => a.submittedAt >= start && a.submittedAt < end).length);
    decided.push(
      applications.filter((a) => a.decidedAt && a.decidedAt >= start && a.decidedAt < end).length,
    );
  }
  return { labels, submitted, decided };
}

export function isDecided(status: string) {
  return ["APPROVED", "CONDITIONALLY_APPROVED", "REJECTED"].includes(status);
}

export function shortStage(stage: string) {
  const map: Record<string, string> = {
    SCRUTINY: "Scrutiny",
    RE_SCRUTINY: "Re-Scrutiny",
    INSTITUTION_RESPONSE: "Institution Reply",
    EVC: "EVC",
    COMMITTEE: "Committee",
    DECISION: "Decision",
    COMPLETED: "Completed",
  };
  return map[stage] ?? stage;
}

export function bucketOf(age: number) {
  return AGEING_BUCKETS.find((b) => age >= b.min && age <= b.max) ?? AGEING_BUCKETS.at(-1)!;
}

// ---------------------------------------------------------------------------
// Single case file
// ---------------------------------------------------------------------------

export async function getCaseFile(id: string) {
  return db.application.findUnique({
    where: { id },
    include: {
      institution: true,
      region: true,
      assignedTo: { select: { id: true, name: true, role: true } },
      evcVisit: true,
      undertakings: { include: { submissions: { orderBy: { submittedAt: "desc" } } }, orderBy: { createdAt: "desc" } },
      transitions: { orderBy: { createdAt: "desc" } },
      routeTemplate: true,
    },
  });
}

export type CaseFile = NonNullable<Awaited<ReturnType<typeof getCaseFile>>>;

export function casePriority(app: CaseFile): PriorityResult {
  return priorityScore({
    dueAt: app.dueAt,
    escalationLevel: app.escalationLevel,
    stageEnteredAt: app.stageEnteredAt,
    evcStatus: app.evcVisit?.status ?? null,
    overdueUndertakings: app.undertakings.filter((u) => u.status === "OVERDUE" || u.status === "ESCALATED").length,
  });
}

export { parseNumberArray, parseStringArray, daysBetween, daysUntil };
