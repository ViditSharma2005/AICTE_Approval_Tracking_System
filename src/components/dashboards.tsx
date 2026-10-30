import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  FileWarning,
  FolderOpen,
  Gavel,
  Inbox,
  ListChecks,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
  GitBranch,
  Bell,
  Building2,
  ArrowRight,
} from "lucide-react";
import type { SessionUser } from "@/lib/session";
import type { getScopedData } from "@/lib/queries";
import { bucketOf, isDecided, regionStats, shortStage, stageMatrix, trend, workloadByOfficer } from "@/lib/queries";
import { AGEING_BUCKETS, ROLE_LABELS } from "@/lib/constants";
import { daysSince, daysUntil } from "@/lib/time";
import { Card, CardHeader, EmptyState, Pill, StatCard, TD, TH, THead, TR, Table } from "./ui";
import { DonutChart, HBarChart, Heatmap, StackedBarChart, TrendChart } from "./charts";
import { DocStatusPill, PriorityBadge, SlaChip, StatusPill, UndertakingStatusPill } from "./case";
import { AutoRefresh } from "./client";
import { TrustBadge } from "@/components/trust-badge";
import { CapacityBar } from "@/components/capacity-bar";

export type ScopedData = Awaited<ReturnType<typeof getScopedData>>;

const now = () => new Date();

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

function MiniList({
  items,
  empty,
}: {
  items: { key: string; title: React.ReactNode; meta: React.ReactNode; href: string; right?: React.ReactNode }[];
  empty: string;
}) {
  if (!items.length) return <EmptyState icon={<Inbox className="h-7 w-7" />} title={empty} />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((i) => (
        <li key={i.key}>
          <Link href={i.href} className="flex items-center gap-3 px-1 py-2.5 transition-colors hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink">{i.title}</p>
              <p className="truncate text-[11px] text-ink-faint">{i.meta}</p>
            </div>
            {i.right}
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ===========================================================================
// INSTITUTION
// ===========================================================================

export function InstitutionDashboard({ user, data }: { user: SessionUser; data: ScopedData }) {
  const { applications, undertakings, documents, notifications } = data;
  const open = applications.filter((a) => !isDecided(a.status));
  const awaitingMe = applications.filter((a) => a.currentStage === "INSTITUTION_RESPONSE");
  const myTasks = undertakings.filter((u) => ["PENDING", "OVERDUE", "ESCALATED"].includes(u.status));
  const expiring = documents.filter((d) => daysUntil(d.expiresAt) <= 90);
  // Feature 1 — an institution sees its own score; the badge opens the full event log.
  const myInstitution = data.institutions[0];
  const trustScore = myInstitution?.trustScore ?? 100;

  const statusCounts = ["IN_PROGRESS", "AWAITING_INSTITUTION", "APPROVED", "CONDITIONALLY_APPROVED", "REJECTED"].map(
    (s) => ({ label: s.replace(/_/g, " "), value: applications.filter((a) => a.status === s).length }),
  );

  return (
    <div className="space-y-6">
      <Row>
        <StatCard label="My applications" value={applications.length} hint={`${open.length} in progress`} icon={<FolderOpen className="h-5 w-5" />} />
        <StatCard
          label="Awaiting my reply"
          value={awaitingMe.length}
          tone={awaitingMe.length ? "amber" : "green"}
          hint="Deficiencies raised by AICTE"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Open undertakings"
          value={myTasks.length}
          tone={myTasks.some((u) => u.status !== "PENDING") ? "red" : "indigo"}
          hint="Conditions of approval to comply with"
          icon={<ListChecks className="h-5 w-5" />}
        />
        <StatCard
          label="Documents expiring"
          value={expiring.length}
          tone={expiring.length ? "amber" : "green"}
          hint="Within the next 90 days"
          icon={<FileWarning className="h-5 w-5" />}
        />
        <StatCard
          label="Compliance trust score"
          value={trustScore}
          tone={trustScore >= 80 ? "green" : trustScore >= 50 ? "amber" : "red"}
          hint={
            <span className="flex items-center gap-1.5">
              {trustScore >= 80 ? "Good standing" : trustScore >= 50 ? "Watch list" : "Concern"}
              {myInstitution ? (
                <TrustBadge institutionId={myInstitution.id} score={trustScore} name={myInstitution.name} />
              ) : null}
            </span>
          }
          icon={<ShieldCheck className="h-5 w-5" />}
        />
      </Row>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Action required from you" subtitle="Deficiencies and undertakings with a live deadline" />
          <MiniList
            empty="Nothing pending — your compliance record is clean."
            items={[
              ...awaitingMe.map((a) => ({
                key: "app-" + a.id,
                title: `${a.refNumber} — reply to deficiency`,
                meta: `${a.programName || a.type} · pending at ${shortStage(a.currentStage)}`,
                href: `/applications/${a.id}`,
                right: <Pill tone="amber">Institution reply</Pill>,
              })),
              ...myTasks.map((u) => ({
                key: "u-" + u.id,
                title: u.title,
                meta: `${u.phase === "PRE" ? "Deficiency" : "Undertaking"} · ${daysUntil(u.dueAt) < 0 ? `${Math.abs(daysUntil(u.dueAt))} day(s) overdue` : `due in ${daysUntil(u.dueAt)} day(s)`}`,
                href: `/institution/respond/${u.id}`,
                right: <UndertakingStatusPill status={u.status} />,
              })),
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Application status" />
          <DonutChart
            data={statusCounts.filter((s) => s.value > 0)}
            centerValue={applications.length}
            centerLabel="applications"
          />
          <Link href="/institution/submit" className="btn-primary btn-sm mt-4 w-full">
            Submit new application
          </Link>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="My applications" subtitle="Most recently updated first" action={<Link href="/applications" className="link text-xs">View all</Link>} />
          {applications.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Programme</TH>
                  <TH>Stage</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {applications.slice(0, 8).map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <Link href={`/applications/${a.id}`} className="link font-mono text-xs">
                        {a.refNumber}
                      </Link>
                    </TD>
                    <TD className="max-w-[180px] truncate">{a.programName || a.type.replace(/_/g, " ")}</TD>
                    <TD>{shortStage(a.currentStage)}</TD>
                    <TD>
                      <StatusPill status={a.status} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={<FolderOpen className="h-7 w-7" />} title="No applications yet" />
          )}
        </Card>

        <Card>
          <CardHeader title="Document validity" subtitle="Renew before the countdown reaches zero" />
          {documents.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Document</TH>
                  <TH>Valid till</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {documents.slice(0, 8).map((d) => (
                  <TR key={d.id}>
                    <TD>{d.type.replace(/_/g, " ")}</TD>
                    <TD className="tnum text-xs">{d.expiresAt.toLocaleDateString("en-IN", { dateStyle: "medium" })}</TD>
                    <TD>
                      <DocStatusPill status={d.status} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={<FileWarning className="h-7 w-7" />} title="No documents on the register" />
          )}
        </Card>
      </div>

      {notifications.length ? (
        <Card>
          <CardHeader title="Latest messages" action={<Link href="/notifications" className="link text-xs">All notifications</Link>} />
          <MiniList
            empty="No messages."
            items={notifications.slice(0, 5).map((n) => ({
              key: n.id,
              title: n.title,
              meta: `${n.body} · ${new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
              href: n.link ?? "/notifications",
              right: n.read ? null : <Pill tone="blue">New</Pill>,
            }))}
          />
        </Card>
      ) : null}
    </div>
  );
}

// ===========================================================================
// PROCESSING OFFICERS (scrutiny / committee / authority / compliance share parts)
// ===========================================================================

export function OfficerDashboard({ user, data }: { user: SessionUser; data: ScopedData }) {
  const { applications, officers, escalations, undertakings } = data;

  const myStages: Record<string, string[]> = {
    SCRUTINY_OFFICER: ["SCRUTINY", "RE_SCRUTINY"],
    COMMITTEE_MEMBER: ["COMMITTEE"],
    EVC_COORDINATOR: ["EVC"],
    COMPETENT_AUTHORITY: ["DECISION"],
  };
  const stages = myStages[user.role] ?? [];
  const queue = applications.filter((a) => stages.includes(a.currentStage) && !isDecided(a.status));
  const mine = queue.filter((a) => a.assignedToId === user.id || user.role !== "SCRUTINY_OFFICER");
  const overdue = mine.filter((a) => a.dueAt && a.dueAt < now());
  const withInst = applications.filter((a) => a.currentStage === "INSTITUTION_RESPONSE");
  const decided = applications.filter((a) => a.decidedAt && daysSince(a.decidedAt) <= 30);

  return (
    <div className="space-y-6">
      <Row>
        <StatCard label="In my queue" value={mine.length} hint={`${stages.join(" / ") || "assigned work"}`} icon={<Inbox className="h-5 w-5" />} />
        <StatCard label="Past SLA" value={overdue.length} tone={overdue.length ? "red" : "green"} hint="Escalations climb automatically" icon={<AlertTriangle className="h-5 w-5" />} />
        <StatCard label="With institution" value={withInst.length} tone="amber" hint="Deficiencies awaiting reply" icon={<Clock className="h-5 w-5" />} />
        <StatCard label="Open escalations" value={escalations.filter((e) => e.status === "OPEN").length} tone="violet" hint="On my desk" icon={<TrendingUp className="h-5 w-5" />} />
        <CapacityBar userId={user.id} role={user.role} />
      </Row>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Today's Action Centre"
            subtitle="Highest priority first — every row is a case file with a live deadline"
            action={<Link href="/applications" className="link text-xs">Open full list</Link>}
          />
          {mine.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Institution</TH>
                  <TH>Stage</TH>
                  <TH>SLA</TH>
                  <TH>Priority</TH>
                </TR>
              </THead>
              <tbody>
                {mine
                  .sort((a, b) => b.priority.score - a.priority.score)
                  .slice(0, 10)
                  .map((a) => (
                    <TR key={a.id}>
                      <TD>
                        <Link href={`/applications/${a.id}`} className="link font-mono text-xs">
                          {a.refNumber}
                        </Link>
                      </TD>
                      <TD className="max-w-[200px]"><span className="flex items-center gap-1.5 truncate"><span className="truncate">{a.institution.name}</span><TrustBadge institutionId={a.institution.id} score={a.institution.trustScore} name={a.institution.name} /></span></TD>
                      <TD>{shortStage(a.currentStage)}</TD>
                      <TD>
                        <SlaChip dueAt={a.dueAt} />
                      </TD>
                      <TD>
                        <PriorityBadge score={a.priority.score} band={a.priority.band} reasons={a.priority.reasons} />
                      </TD>
                    </TR>
                  ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={<CheckCircle2 className="h-7 w-7" />} title="Your queue is clear" hint="No case file is waiting on your role right now." />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Pendency by stage" subtitle="Ageing since submission" />
            <StackedBarChart
              rows={stageMatrix(applications)}
              segments={AGEING_BUCKETS.map((b) => ({ key: b.key, label: b.label, color: b.color }))}
            />
          </Card>

          <Card>
            <CardHeader title="Team workload" />
            <HBarChart
              data={workloadByOfficer(applications, officers)
                .slice(0, 6)
                .map((o) => ({ label: o.name, value: o.open }))}
              emptyHint="No officers configured for this region."
            />
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Cases awaiting the institution" subtitle="Deficiency replies overdue by more than 7 days need a reminder" />
        <MiniList
          empty="Nothing is waiting on an institution."
          items={withInst.slice(0, 6).map((a) => ({
            key: a.id,
            title: `${a.refNumber} — ${a.institution.name}`,
            meta: `${daysSince(a.stageEnteredAt)} day(s) at this stage`,
            href: `/applications/${a.id}`,
            right: <SlaChip dueAt={a.dueAt} />,
          }))}
        />
      </Card>
    </div>
  );
}

// ===========================================================================
// EVC
// ===========================================================================

export function EvcDashboard({ user, data }: { user: SessionUser; data: ScopedData }) {
  const visits = data.applications.filter((a) => a.evcVisit).map((a) => ({ app: a, evc: a.evcVisit! }));
  const queued = visits.filter((v) => v.evc.status === "QUEUED");
  const scheduled = visits.filter((v) => v.evc.status === "SCHEDULED");
  const overdue = visits.filter((v) => v.evc.status === "OVERDUE");
  const completed = visits.filter((v) => v.evc.status === "COMPLETED");

  return (
    <div className="space-y-6">
      <Row>
        <StatCard label="Queued" value={queued.length} hint="Awaiting constitution & scheduling" icon={<ClipboardCheck className="h-5 w-5" />} />
        <StatCard label="Scheduled" value={scheduled.length} tone="indigo" hint="Visit date fixed" icon={<Clock className="h-5 w-5" />} />
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "red" : "green"} hint="Escalated to Regional Officer" icon={<AlertTriangle className="h-5 w-5" />} />
        <StatCard label="Reports filed" value={completed.length} tone="green" hint="Ready to close the stage" icon={<CheckCircle2 className="h-5 w-5" />} />
        <CapacityBar userId={user.id} role={user.role} label="My inspection load" />
      </Row>

      <Card>
        <CardHeader title="Inspection queue" subtitle="Every visit has its own SLA and escalation path" />
        {visits.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Institution</TH>
                <TH>Status</TH>
                <TH>Scheduled</TH>
                <TH>Panel</TH>
                <TH>Visit SLA</TH>
              </TR>
            </THead>
            <tbody>
              {visits.map(({ app, evc }) => (
                <TR key={evc.id}>
                  <TD>
                    <Link href={`/evc/${evc.id}`} className="link font-mono text-xs">
                      {app.refNumber}
                    </Link>
                  </TD>
                  <TD className="max-w-[220px]"><span className="flex items-center gap-1.5 truncate"><span className="truncate">{app.institution.name}</span><TrustBadge institutionId={app.institution.id} score={app.institution.trustScore} name={app.institution.name} /></span></TD>
                  <TD>
                    <Pill
                      tone={
                        evc.status === "COMPLETED" ? "green" : evc.status === "OVERDUE" ? "red" : evc.status === "SCHEDULED" ? "blue" : "slate"
                      }
                    >
                      {evc.status}
                    </Pill>
                  </TD>
                  <TD className="text-xs">
                    {evc.scheduledFor
                      ? evc.scheduledFor.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                      : "—"}
                  </TD>
                  <TD className="text-xs">{JSON.parse(evc.members || "[]").length || "—"}</TD>
                  <TD>
                    <SlaChip dueAt={evc.dueAt} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<ClipboardCheck className="h-7 w-7" />} title="No inspections in the queue" />
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// COMPLIANCE OFFICER
// ===========================================================================

export function ComplianceDashboard({ user, data }: { user: SessionUser; data: ScopedData }) {
  const { undertakings, documents } = data;
  const pending = undertakings.filter((u) => u.status === "PENDING");
  const awaiting = undertakings.filter((u) => u.status === "SUBMITTED");
  const overdue = undertakings.filter((u) => ["OVERDUE", "ESCALATED"].includes(u.status));
  const verified = undertakings.filter((u) => u.status === "VERIFIED");
  const expiring = documents.filter((d) => d.status !== "EXPIRED" && daysUntil(d.expiresAt) <= 90);
  const expired = documents.filter((d) => d.status === "EXPIRED");
  const renewals = documents.filter((d) => d.status === "RENEWAL_SUBMITTED");

  return (
    <div className="space-y-6">
      <Row>
        <StatCard label="Awaiting verification" value={awaiting.length} tone={awaiting.length ? "amber" : "green"} hint="Institutions have uploaded proof" icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Pending compliance" value={pending.length} hint="Not yet due" icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label="Overdue / escalated" value={overdue.length} tone={overdue.length ? "red" : "green"} hint="Past the compliance deadline" icon={<AlertTriangle className="h-5 w-5" />} />
        <StatCard label="Renewals to verify" value={renewals.length} tone="violet" hint="Documents uploaded for renewal" icon={<FileWarning className="h-5 w-5" />} />
        <CapacityBar userId={user.id} role={user.role} label="My verification load" />
      </Row>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Compliance posture" />
          <DonutChart
            data={[
              { label: "Verified", value: verified.length, color: "#22C55E" },
              { label: "Awaiting verification", value: awaiting.length, color: "#F59E0B" },
              { label: "Pending", value: pending.length, color: "#4F46E5" },
              { label: "Overdue", value: overdue.length, color: "#EF4444" },
            ].filter((d) => d.value > 0)}
            centerValue={undertakings.length}
            centerLabel="undertakings"
          />
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Verification queue" subtitle="Proof of compliance uploaded by institutions" action={<Link href="/undertakings" className="link text-xs">Open undertakings</Link>} />
          <MiniList
            empty="Nothing awaiting verification."
            items={awaiting.slice(0, 8).map((u) => ({
              key: u.id,
              title: `${u.title} — ${u.institution.name}`,
              meta: `Due ${u.dueAt.toLocaleDateString("en-IN", { dateStyle: "medium" })}`,
              href: "/undertakings",
              right: <UndertakingStatusPill status={u.status} />,
            }))}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Expiry watch" subtitle="90 / 60 / 30 / 7 / 0 day alerts fire automatically" action={<Link href="/documents" className="link text-xs">Document register</Link>} />
          {expiring.length || expired.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Institution</TH>
                  <TH>Document</TH>
                  <TH>Expires</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {[...expired, ...expiring].slice(0, 8).map((d) => (
                  <TR key={d.id}>
                    <TD className="max-w-[180px]"><span className="flex items-center gap-1.5 truncate"><span className="truncate">{d.institution.name}</span><TrustBadge institutionId={d.institution.id} score={d.institution.trustScore} name={d.institution.name} /></span></TD>
                    <TD>{d.type.replace(/_/g, " ")}</TD>
                    <TD className="tnum text-xs">{d.expiresAt.toLocaleDateString("en-IN", { dateStyle: "medium" })}</TD>
                    <TD>
                      <DocStatusPill status={d.status} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={<FileWarning className="h-7 w-7" />} title="No documents nearing expiry" />
          )}
        </Card>

        <Card>
          <CardHeader title="Overdue undertakings" subtitle="These climb the escalation ladder automatically" />
          <MiniList
            empty="Every institution is inside its compliance window."
            items={overdue.slice(0, 8).map((u) => ({
              key: u.id,
              title: `${u.title} — ${u.institution.name}`,
              meta: `${Math.abs(daysUntil(u.dueAt))} day(s) past deadline`,
              href: "/undertakings",
              right: <UndertakingStatusPill status={u.status} />,
            }))}
          />
        </Card>
      </div>
    </div>
  );
}

// ===========================================================================
// REGIONAL OFFICER
// ===========================================================================

export function RegionalDashboard({ user, data }: { user: SessionUser; data: ScopedData }) {
  const { applications, officers, undertakings, documents, escalations } = data;
  const open = applications.filter((a) => !isDecided(a.status));
  const overdue = open.filter((a) => a.dueAt && a.dueAt < now());
  const openEsc = escalations.filter((e) => e.status === "OPEN");
  const avgPendency = open.length ? Math.round(open.reduce((s, a) => s + daysSince(a.submittedAt), 0) / open.length) : 0;

  const byInstitution = new Map<string, number>();
  for (const a of open) byInstitution.set(a.institution.name, (byInstitution.get(a.institution.name) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <Row>
        <StatCard label="Live applications" value={open.length} hint={`${applications.length} received in total`} icon={<FolderOpen className="h-5 w-5" />} />
        <StatCard label="Past SLA" value={overdue.length} tone={overdue.length ? "red" : "green"} hint="Being escalated right now" icon={<Timer className="h-5 w-5" />} />
        <StatCard label="Open escalations" value={openEsc.length} tone="violet" hint="On my desk to resolve" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Average pendency" value={`${avgPendency}d`} hint="Across all live cases" icon={<Clock className="h-5 w-5" />} />
      </Row>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Stage × ageing" subtitle="Where the region's cases are piling up" />
          <StackedBarChart
            rows={stageMatrix(applications)}
            segments={AGEING_BUCKETS.map((b) => ({ key: b.key, label: b.label, color: b.color }))}
          />
        </Card>

        <Card>
          <CardHeader title="Officer workload" subtitle="Live cases per officer" />
          <HBarChart
            data={workloadByOfficer(applications, officers).map((o) => ({ label: o.name, value: o.open }))}
            emptyHint="No officers in this region."
          />
          <p className="hint mt-3">
            An uneven bar chart is a bottleneck. Re-assign from the case file to balance the load.
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Escalations" action={<Link href="/escalations" className="link text-xs">All</Link>} />
          <MiniList
            empty="No open escalations in this region."
            items={openEsc.slice(0, 6).map((e) => ({
              key: e.id,
              title: `Level ${e.level} · ${e.entityType}`,
              meta: e.reason,
              href: "/escalations",
              right: <SlaChip dueAt={e.createdAt} />,
            }))}
          />
        </Card>

        <Card>
          <CardHeader title="Busiest institutions" />
          <HBarChart
            data={[...byInstitution.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ label: k, value: v }))}
          />
        </Card>

        <Card>
          <CardHeader title="Compliance snapshot" />
          <ul className="space-y-2 text-sm">
            {[
              ["Undertakings overdue", undertakings.filter((u) => ["OVERDUE", "ESCALATED"].includes(u.status)).length, "red"],
              ["Undertakings awaiting verification", undertakings.filter((u) => u.status === "SUBMITTED").length, "amber"],
              ["Documents expired", documents.filter((d) => d.status === "EXPIRED").length, "red"],
              ["Documents expiring ≤ 90d", documents.filter((d) => d.status === "EXPIRING_SOON").length, "amber"],
            ].map(([label, value, tone]) => (
              <li key={String(label)} className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{label}</span>
                <Pill tone={tone as "red" | "amber"}>{String(value)}</Pill>
              </li>
            ))}
          </ul>
          <Link href="/reports" className="btn-secondary btn-sm mt-4 w-full">
            Open report centre
          </Link>
        </Card>
      </div>
    </div>
  );
}

// ===========================================================================
// BUREAU / NATIONAL
// ===========================================================================

export function BureauDashboard({ user, data }: { user: SessionUser; data: ScopedData }) {
  const { applications, regions, officers, escalations } = data;
  const open = applications.filter((a) => !isDecided(a.status));
  const overdue = open.filter((a) => a.dueAt && a.dueAt < now());
  const decided = applications.filter((a) => isDecided(a.status));
  const stats = regionStats(applications, regions);
  const t = trend(applications);

  const stages = ["SCRUTINY", "INSTITUTION_RESPONSE", "EVC", "COMMITTEE", "DECISION"];
  const heat = regions.map((r) =>
    stages.map((s) => applications.filter((a) => a.regionId === r.id && a.currentStage === s && !isDecided(a.status)).length),
  );

  const bottleneck = stages
    .map((s) => {
      const rows = applications.filter((a) => a.currentStage === s && !isDecided(a.status));
      const avg = rows.length ? Math.round(rows.reduce((sum, a) => sum + daysSince(a.stageEnteredAt), 0) / rows.length) : 0;
      return { label: shortStage(s), value: avg };
    })
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalMs={20000} />
      <Row>
        <StatCard label="Live applications" value={open.length} hint={`${applications.length} received`} icon={<FolderOpen className="h-5 w-5" />} />
        <StatCard label="Past SLA nationwide" value={overdue.length} tone={overdue.length ? "red" : "green"} hint={`${open.length ? Math.round((overdue.length / open.length) * 100) : 0}% of live cases`} icon={<AlertTriangle className="h-5 w-5" />} />
        <StatCard label="Disposed" value={decided.length} tone="green" hint="Approved / rejected / conditional" icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Open escalations" value={escalations.filter((e) => e.status === "OPEN").length} tone="violet" icon={<TrendingUp className="h-5 w-5" />} />
      </Row>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Region-wise pendency" subtitle="Live cases by region" />
          <HBarChart data={stats.map((s) => ({ label: s.name, value: s.open }))} />
          <div className="mt-4 border-t border-slate-100 pt-3">
            <Table>
              <THead>
                <TR>
                  <TH>Region</TH>
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
                    <TD className="tnum">{s.open}</TD>
                    <TD className="tnum">
                      <Pill tone={s.overdue ? "red" : "green"}>{s.overdue}</Pill>
                    </TD>
                    <TD className="tnum">{s.avgPendency}d</TD>
                    <TD className="tnum">{s.decided}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Where time is lost" subtitle="Average days in each stage" />
            <HBarChart data={bottleneck} suffix="d" />
          </Card>

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
        </div>
      </div>

      <Card>
        <CardHeader title="Bottleneck heat map" subtitle="Live cases: region × stage" />
        <Heatmap rows={regions.map((r) => r.name)} cols={stages.map(shortStage)} values={heat} />
      </Card>

      <Card>
        <CardHeader title="Escalation register" action={<Link href="/escalations" className="link text-xs">Resolve escalations</Link>} />
        {escalations.filter((e) => e.status === "OPEN").length ? (
          <Table>
            <THead>
              <TR>
                <TH>Level</TH>
                <TH>Entity</TH>
                <TH>Reason</TH>
                <TH>Raised</TH>
              </TR>
            </THead>
            <tbody>
              {escalations
                .filter((e) => e.status === "OPEN")
                .slice(0, 8)
                .map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <Pill tone={e.level >= 2 ? "red" : "amber"}>L{e.level}</Pill>
                    </TD>
                    <TD>{e.entityType}</TD>
                    <TD className="max-w-[420px] truncate text-xs text-ink-soft">{e.reason}</TD>
                    <TD className="text-xs">{new Date(e.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</TD>
                  </TR>
                ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<ShieldCheck className="h-7 w-7" />} title="No open escalations" />
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// POLICY ADMIN + SYSTEM ADMIN
// ===========================================================================

export function PolicyDashboard({ user, data, rules }: { user: SessionUser; data: ScopedData; rules: { id: string; key: string; name: string; version: number; status: string; publishedAt: Date | null }[] }) {
  const { applications } = data;
  const open = applications.filter((a) => !isDecided(a.status));
  const published = rules.filter((r) => r.status === "PUBLISHED");

  return (
    <div className="space-y-6">
      <Row>
        <StatCard label="Published routes" value={published.length} hint="Live APH rule versions" icon={<GitBranch className="h-5 w-5" />} />
        <StatCard label="Rule versions" value={rules.length} hint="Full version history retained" icon={<Clock className="h-5 w-5" />} />
        <StatCard label="Live applications" value={open.length} hint="Bound to the rules they were filed under" icon={<FolderOpen className="h-5 w-5" />} />
        <StatCard label="Past SLA" value={open.filter((a) => a.dueAt && a.dueAt < now()).length} tone="red" icon={<AlertTriangle className="h-5 w-5" />} />
      </Row>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rule engine" subtitle="Which applications each published route currently claims" action={<Link href="/admin/rules" className="link text-xs">Open rule engine</Link>} />
          <Table>
            <THead>
              <TR>
                <TH>Route</TH>
                <TH>Version</TH>
                <TH>Status</TH>
                <TH>In-flight cases</TH>
              </TR>
            </THead>
            <tbody>
              {rules
                .slice()
                .sort((a, b) => b.version - a.version)
                .slice(0, 8)
                .map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link href={`/admin/rules/${r.id}`} className="link">
                        {r.name}
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs">v{r.version}</TD>
                    <TD>
                      <Pill tone={r.status === "PUBLISHED" ? "green" : r.status === "DRAFT" ? "amber" : "slate"}>{r.status}</Pill>
                    </TD>
                    <TD className="tnum">{applications.filter((a) => a.routeKey === r.key).length}</TD>
                  </TR>
                ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="SLA compliance by stage" subtitle="Average days spent in each stage" />
          <HBarChart
            data={["SCRUTINY", "INSTITUTION_RESPONSE", "EVC", "COMMITTEE", "DECISION"]
              .map((s) => {
                const rows = applications.filter((a) => a.currentStage === s && !isDecided(a.status));
                return {
                  label: shortStage(s),
                  value: rows.length ? Math.round(rows.reduce((sum, a) => sum + daysSince(a.stageEnteredAt), 0) / rows.length) : 0,
                };
              })
              .sort((a, b) => b.value - a.value)}
            suffix="d"
          />
        </Card>
      </div>
    </div>
  );
}

export function AdminDashboard({ user, data, chain, userCount }: { user: SessionUser; data: ScopedData; chain: { total: number; intact: boolean }; userCount: number }) {
  const roleCounts = data.users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Row>
        <StatCard label="Users" value={userCount} hint="Across all roles" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Institutions" value={data.institutions.length} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Applications" value={data.applications.length} icon={<FolderOpen className="h-5 w-5" />} />
        <StatCard
          label="Audit entries"
          value={chain.total}
          tone={chain.intact ? "green" : "red"}
          hint={chain.intact ? "Hash chain verified intact" : "TAMPERING DETECTED"}
          icon={<ShieldCheck className="h-5 w-5" />}
        />
      </Row>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Users by role" action={<Link href="/admin/users" className="link text-xs">Manage users</Link>} />
          <HBarChart
            data={Object.entries(roleCounts)
              .map(([role, count]) => ({ label: ROLE_LABELS[role] ?? role, value: count }))
              .sort((a, b) => b.value - a.value)}
          />
        </Card>

        <Card>
          <CardHeader title="System integrity" subtitle="Append-only, hash-chained audit trail" action={<Link href="/admin/audit" className="link text-xs">Open audit trail</Link>} />
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-soft">Chain status</span>
              <Pill tone={chain.intact ? "green" : "red"}>{chain.intact ? "INTACT" : "BROKEN"}</Pill>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-soft">Entries</span>
              <span className="font-mono tnum">{chain.total}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-soft">Escalations raised</span>
              <span className="font-mono tnum">{data.escalations.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-soft">Notifications delivered</span>
              <span className="font-mono tnum">{data.notifications.length}</span>
            </div>
          </div>
          <p className="hint mt-4">
            Every state change writes an entry that commits to the hash of the one before it. Editing history breaks
            the chain and the audit page proves it.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ===========================================================================
// Router
// ===========================================================================

export const DASHBOARD_BY_ROLE: Record<string, string> = {
  INSTITUTION: "My institution",
  SCRUTINY_OFFICER: "Scrutiny desk",
  EVC_COORDINATOR: "Inspection desk",
  EVC_MEMBER: "Inspection desk",
  COMMITTEE_MEMBER: "Committee desk",
  COMPETENT_AUTHORITY: "Decision desk",
  COMPLIANCE_OFFICER: "Compliance desk",
  REGIONAL_OFFICER: "Regional command view",
  BUREAU_OFFICER: "National command view",
  POLICY_ADMIN: "Policy & rules",
  SYSTEM_ADMIN: "System administration",
};
