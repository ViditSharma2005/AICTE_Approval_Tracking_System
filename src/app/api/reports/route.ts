import { db } from "@/lib/db";
import { getUser } from "@/lib/session";
import { scopeFor } from "@/lib/rbac";
import { toCsv } from "@/lib/format";
import { isDecided, regionStats, shortStage } from "@/lib/queries";
import { daysSince, daysUntil } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Consolidated report export — CSV opens straight in Excel. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role === "INSTITUTION") return new Response("Forbidden", { status: 403 });

  const type = new URL(request.url).searchParams.get("type") ?? "pendency";
  const scope = scopeFor(user);

  let filename = "report.csv";
  let csv = "";

  if (type === "pendency") {
    const [apps, regions] = await Promise.all([
      db.application.findMany({ where: scope, select: { regionId: true, status: true, dueAt: true, submittedAt: true } }),
      db.region.findMany({ orderBy: { name: "asc" } }),
    ]);
    const stats = regionStats(apps as never, regions);
    filename = "region-wise-pendency.csv";
    csv = toCsv(
      ["Region", "Received", "Live", "Past SLA", "Avg pendency (days)", "Disposed"],
      stats.map((s) => [s.name, s.total, s.open, s.overdue, s.avgPendency, s.decided]),
    );
  }

  if (type === "compliance") {
    const undertakings = await db.undertaking.findMany({
      where:
        user.regionId && !["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
          ? { institution: { regionId: user.regionId } }
          : {},
      include: { institution: { select: { name: true } } },
    });

    const rows = Object.values(
      undertakings.reduce<Record<string, { name: string; total: number; verified: number; awaiting: number; overdue: number }>>(
        (acc, u) => {
          const r = (acc[u.institutionId] ||= { name: u.institution.name, total: 0, verified: 0, awaiting: 0, overdue: 0 });
          r.total += 1;
          if (u.status === "VERIFIED") r.verified += 1;
          if (u.status === "SUBMITTED") r.awaiting += 1;
          if (["OVERDUE", "ESCALATED"].includes(u.status)) r.overdue += 1;
          return acc;
        },
        {},
      ),
    );

    filename = "institution-compliance.csv";
    csv = toCsv(
      ["Institution", "Total undertakings", "Verified", "Awaiting verification", "Overdue", "Compliance rate %"],
      rows.map((r) => [r.name, r.total, r.verified, r.awaiting, r.overdue, Math.round((r.verified / r.total) * 100)]),
    );
  }

  if (type === "overdue") {
    const apps = await db.application.findMany({
      where: scope,
      include: { institution: { select: { name: true } }, region: { select: { name: true } }, assignedTo: { select: { name: true } } },
    });
    const rows = apps.filter((a) => !isDecided(a.status) && a.dueAt && a.dueAt < new Date());
    filename = "overdue-cases.csv";
    csv = toCsv(
      ["Reference", "Institution", "Region", "Stage", "Officer", "SLA ended", "Days late", "Escalation level"],
      rows.map((a) => [
        a.refNumber,
        a.institution.name,
        a.region.name,
        shortStage(a.currentStage),
        a.assignedTo?.name ?? "Unassigned",
        a.dueAt!.toISOString().slice(0, 10),
        daysSince(a.dueAt!),
        a.escalationLevel,
      ]),
    );
  }

  if (type === "documents") {
    const docs = await db.document.findMany({
      where:
        user.regionId && !["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
          ? { institution: { regionId: user.regionId } }
          : {},
      include: { institution: { select: { name: true } } },
      orderBy: { expiresAt: "asc" },
    });
    filename = "document-expiry-register.csv";
    csv = toCsv(
      ["Institution", "Document", "File", "Valid till", "Days left", "Status"],
      docs.map((d) => [d.institution.name, d.type, d.fileName, d.expiresAt.toISOString().slice(0, 10), daysUntil(d.expiresAt), d.status]),
    );
  }

  if (type === "escalations") {
    const rows = await db.escalation.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    filename = "escalation-register.csv";
    csv = toCsv(
      ["Raised", "Level", "Entity", "Reason", "To role", "Status", "Resolved by", "Resolved at"],
      rows.map((e) => [
        e.createdAt.toISOString().slice(0, 16).replace("T", " "),
        e.level,
        e.entityType,
        e.reason,
        e.toRole,
        e.status,
        e.resolvedBy ?? "",
        e.resolvedAt ? e.resolvedAt.toISOString().slice(0, 16).replace("T", " ") : "",
      ]),
    );
  }

  if (type === "ageing") {
    const apps = await db.application.findMany({
      where: scope,
      include: { institution: { select: { name: true } }, region: { select: { name: true } } },
    });
    filename = "stage-wise-ageing.csv";
    csv = toCsv(
      ["Reference", "Institution", "Region", "Stage", "Status", "Submitted", "Age (days)", "Escalation level"],
      apps.map((a) => [
        a.refNumber,
        a.institution.name,
        a.region.name,
        shortStage(a.currentStage),
        a.status,
        a.submittedAt.toISOString().slice(0, 10),
        daysSince(a.submittedAt),
        a.escalationLevel,
      ]),
    );
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
