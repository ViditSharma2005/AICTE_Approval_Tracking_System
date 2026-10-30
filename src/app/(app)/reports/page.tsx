import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { scopeFor } from "@/lib/rbac";
import { PageHeader } from "@/components/app-shell";
import { Card, CardHeader, EmptyState, Pill, TD, TH, THead, TR, Table, Banner } from "@/components/ui";
import { HBarChart, StackedBarChart, TrendChart } from "@/components/charts";
import { AGEING_BUCKETS } from "@/lib/constants";
import { bucketOf, isDecided, regionStats, shortStage, stageMatrix, trend } from "@/lib/queries";
import { daysSince, daysUntil, fmtDate } from "@/lib/time";
import { BarChart3, Download } from "lucide-react";
import { TrustBadge } from "@/components/trust-badge";

export const dynamic = "force-dynamic";

const REPORTS = [
  { key: "pendency", label: "Region-wise pendency", hint: "Live cases, past-SLA count and average pendency per region" },
  { key: "ageing", label: "Stage-wise ageing", hint: "Where time is being lost, bucketed 0–7 / 8–15 / 16–30 / 30+" },
  { key: "compliance", label: "Institution compliance", hint: "Undertakings verified vs overdue, institution by institution" },
  { key: "overdue", label: "Overdue case register", hint: "Every live case file past its stage SLA" },
  { key: "documents", label: "Document expiry register", hint: "Validity position of every statutory document" },
  { key: "escalations", label: "Escalation register", hint: "Every escalation raised by the deadline engine" },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role === "INSTITUTION") {
    return (
      <div>
        <PageHeader title="Report centre" />
        <Banner tone="indigo" title="Not available">
          Consolidated reports are an internal supervisory view.
        </Banner>
      </div>
    );
  }

  const sp = await searchParams;
  const key = typeof sp.report === "string" ? sp.report : "pendency";

  const scope = scopeFor(user);
  const [applications, regions, undertakings, documents, escalations] = await Promise.all([
    db.application.findMany({
      where: scope,
      include: {
        institution: { select: { id: true, name: true, city: true, trustScore: true } },
        region: { select: { id: true, name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { submittedAt: "desc" },
    }),
    db.region.findMany({ orderBy: { name: "asc" } }),
    db.undertaking.findMany({
      where: user.regionId && !["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
        ? { institution: { regionId: user.regionId } }
        : {},
      include: { institution: { select: { id: true, name: true, regionId: true, trustScore: true } } },
    }),
    db.document.findMany({
      where: user.regionId && !["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
        ? { institution: { regionId: user.regionId } }
        : {},
      include: { institution: { select: { id: true, name: true, trustScore: true } } },
      orderBy: { expiresAt: "asc" },
    }),
    db.escalation.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  const stats = regionStats(applications, regions).filter((s) => s.total > 0);
  const t = trend(applications);
  const overdue = applications.filter((a) => !isDecided(a.status) && a.dueAt && a.dueAt < new Date());

  return (
    <div>
      <PageHeader
        title="Report centre"
        subtitle="Consolidated, exportable reports — generated live from the case files"
        actions={
          <a href={`/api/reports?type=${key}`} className="btn-primary btn-sm">
            <Download className="h-4 w-4" /> Export CSV
          </a>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.key} href={`/reports?report=${r.key}`}>
            <Card className={`h-full ${key === r.key ? "ring-2 ring-indigo-500" : ""}`}>
              <p className="text-sm font-semibold text-ink">{r.label}</p>
              <p className="mt-1 text-xs text-ink-soft">{r.hint}</p>
            </Card>
          </Link>
        ))}
      </div>

      {/* Summary strip, always visible */}
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Submissions vs disposals" />
          <TrendChart
            labels={t.labels}
            series={[
              { name: "Submitted", color: "#4F46E5", values: t.submitted },
              { name: "Disposed", color: "#22C55E", values: t.decided },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Live cases by region" />
          <HBarChart data={stats.map((s) => ({ label: s.name, value: s.open }))} />
        </Card>
      </div>

      {key === "pendency" ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Region-wise pendency" subtitle="All figures computed from live case files" />
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Region</TH>
                <TH>Received</TH>
                <TH>Live</TH>
                <TH>Past SLA</TH>
                <TH>Avg pendency</TH>
                <TH>Disposed</TH>
              </TR>
            </THead>
            <tbody>
              {stats.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD className="tnum">{s.total}</TD>
                  <TD className="tnum">{s.open}</TD>
                  <TD className="tnum">
                    <Pill tone={s.overdue ? "red" : "green"}>{s.overdue}</Pill>
                  </TD>
                  <TD className="tnum">{s.avgPendency} days</TD>
                  <TD className="tnum">{s.decided}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {key === "ageing" ? (
        <Card>
          <CardHeader title="Stage-wise ageing" subtitle="Age measured from the date of submission" />
          <StackedBarChart
            rows={stageMatrix(applications)}
            segments={AGEING_BUCKETS.map((b) => ({ key: b.key, label: b.label, color: b.color }))}
          />
          <div className="mt-5 border-t border-slate-100 pt-4">
            <Table>
              <THead>
                <TR>
                  <TH>Stage</TH>
                  {AGEING_BUCKETS.map((b) => (
                    <TH key={b.key}>{b.label}</TH>
                  ))}
                  <TH>Total</TH>
                </TR>
              </THead>
              <tbody>
                {stageMatrix(applications)
                  .filter((r) => AGEING_BUCKETS.reduce((s, b) => s + r.values[b.key], 0) > 0)
                  .map((r) => (
                    <TR key={r.label}>
                      <TD className="font-medium">{r.label}</TD>
                      {AGEING_BUCKETS.map((b) => (
                        <TD key={b.key} className="tnum">
                          {r.values[b.key]}
                        </TD>
                      ))}
                      <TD className="tnum font-semibold">
                        {AGEING_BUCKETS.reduce((s, b) => s + r.values[b.key], 0)}
                      </TD>
                    </TR>
                  ))}
              </tbody>
            </Table>
          </div>
        </Card>
      ) : null}

      {key === "compliance" ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Institution compliance" subtitle="Undertakings and deficiencies, institution by institution" />
          </div>
          {undertakings.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Institution</TH>
                  <TH>Total</TH>
                  <TH>Verified</TH>
                  <TH>Awaiting</TH>
                  <TH>Overdue</TH>
                  <TH>Compliance rate</TH>
                </TR>
              </THead>
              <tbody>
                {Object.values(
                  undertakings.reduce<Record<string, { name: string; total: number; verified: number; awaiting: number; overdue: number }>>(
                    (acc, u) => {
                      const row = (acc[u.institutionId] ||= { name: u.institution.name, total: 0, verified: 0, awaiting: 0, overdue: 0 });
                      row.total += 1;
                      if (u.status === "VERIFIED") row.verified += 1;
                      if (u.status === "SUBMITTED") row.awaiting += 1;
                      if (["OVERDUE", "ESCALATED"].includes(u.status)) row.overdue += 1;
                      return acc;
                    },
                    {},
                  ),
                )
                  .sort((a, b) => b.overdue - a.overdue || b.total - a.total)
                  .map((r) => (
                    <TR key={r.name}>
                      <TD className="font-medium">{r.name}</TD>
                      <TD className="tnum">{r.total}</TD>
                      <TD className="tnum">{r.verified}</TD>
                      <TD className="tnum">{r.awaiting}</TD>
                      <TD className="tnum">
                        <Pill tone={r.overdue ? "red" : "green"}>{r.overdue}</Pill>
                      </TD>
                      <TD className="tnum">{Math.round((r.verified / r.total) * 100)}%</TD>
                    </TR>
                  ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState icon={<BarChart3 className="h-7 w-7" />} title="No compliance data yet" />
            </div>
          )}
        </Card>
      ) : null}

      {key === "overdue" ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Overdue case register" subtitle={`${overdue.length} live case file(s) past SLA`} />
          </div>
          {overdue.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Institution</TH>
                  <TH>Stage</TH>
                  <TH>Officer</TH>
                  <TH>SLA ended</TH>
                  <TH>Days late</TH>
                  <TH>Level</TH>
                </TR>
              </THead>
              <tbody>
                {overdue
                  .sort((a, b) => (a.dueAt!.getTime() ?? 0) - (b.dueAt!.getTime() ?? 0))
                  .map((a) => (
                    <TR key={a.id}>
                      <TD>
                        <Link href={`/applications/${a.id}`} className="link font-mono text-xs">
                          {a.refNumber}
                        </Link>
                      </TD>
                      <TD className="max-w-[220px]"><span className="flex items-center gap-1.5 truncate"><span className="truncate">{a.institution.name}</span><TrustBadge institutionId={a.institution.id} score={a.institution.trustScore} name={a.institution.name} /></span></TD>
                      <TD>{shortStage(a.currentStage)}</TD>
                      <TD className="text-xs">{a.assignedTo?.name ?? "Unassigned"}</TD>
                      <TD className="tnum text-xs">{fmtDate(a.dueAt)}</TD>
                      <TD className="tnum">{daysSince(a.dueAt!)}</TD>
                      <TD>
                        <Pill tone={a.escalationLevel >= 2 ? "red" : "amber"}>L{a.escalationLevel}</Pill>
                      </TD>
                    </TR>
                  ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState icon={<BarChart3 className="h-7 w-7" />} title="Nothing is past SLA" />
            </div>
          )}
        </Card>
      ) : null}

      {key === "documents" ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Document expiry register" />
          </div>
          {documents.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Institution</TH>
                  <TH>Document</TH>
                  <TH>File</TH>
                  <TH>Valid till</TH>
                  <TH>Days left</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {documents.map((d) => (
                  <TR key={d.id}>
                    <TD className="max-w-[200px]"><span className="flex items-center gap-1.5 truncate"><span className="truncate">{d.institution.name}</span><TrustBadge institutionId={d.institution.id} score={d.institution.trustScore} name={d.institution.name} /></span></TD>
                    <TD>{d.type.replace(/_/g, " ")}</TD>
                    <TD className="font-mono text-xs">{d.fileName}</TD>
                    <TD className="tnum text-xs">{fmtDate(d.expiresAt)}</TD>
                    <TD className="tnum">{daysUntil(d.expiresAt)}</TD>
                    <TD>
                      <Pill
                        tone={
                          d.status === "EXPIRED" ? "red" : d.status === "EXPIRING_SOON" ? "amber" : d.status === "RENEWAL_SUBMITTED" ? "blue" : "green"
                        }
                      >
                        {d.status.replace(/_/g, " ")}
                      </Pill>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState icon={<BarChart3 className="h-7 w-7" />} title="No documents registered" />
            </div>
          )}
        </Card>
      ) : null}

      {key === "escalations" ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Escalation register" subtitle="Raised automatically, resolved by a named officer" />
          </div>
          {escalations.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Raised</TH>
                  <TH>Level</TH>
                  <TH>Entity</TH>
                  <TH>Reason</TH>
                  <TH>To</TH>
                  <TH>Status</TH>
                  <TH>Resolved by</TH>
                </TR>
              </THead>
              <tbody>
                {escalations.slice(0, 100).map((e) => (
                  <TR key={e.id}>
                    <TD className="text-xs">{fmtDate(e.createdAt)}</TD>
                    <TD>
                      <Pill tone={e.level >= 2 ? "red" : "amber"}>L{e.level}</Pill>
                    </TD>
                    <TD>{e.entityType}</TD>
                    <TD className="max-w-[380px] truncate text-xs text-ink-soft">{e.reason}</TD>
                    <TD className="text-xs">{e.toRole.replace(/_/g, " ")}</TD>
                    <TD>
                      <Pill tone={e.status === "OPEN" ? "red" : "green"}>{e.status}</Pill>
                    </TD>
                    <TD className="text-xs">{e.resolvedBy ?? "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState icon={<BarChart3 className="h-7 w-7" />} title="No escalations raised" />
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
