import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { casePriority, getCaseFile, shortStage } from "@/lib/queries";
import { db } from "@/lib/db";
import { APP_TYPES, DOC_TYPE_LABELS, STAGES } from "@/lib/constants";
import { parseNumberMap, parseStringArray } from "@/lib/json";
import { daysSince, daysUntil, fmtDate, fmtDateTime } from "@/lib/time";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader, EmptyState, KeyValue, Pill, TD, TH, THead, TR, Table } from "@/components/ui";
import {
  CaseTimeline,
  DocChip,
  DocStatusPill,
  EvcStatusPill,
  Members,
  PriorityBadge,
  SlaChip,
  StageStepper,
  StatusPill,
  UndertakingStatusPill,
} from "@/components/case";
import { PrintButton } from "@/components/client";
import { ActionForm } from "@/components/forms";
import { assignApplication } from "@/app/actions/application";
import { availableActions, effectiveStage } from "@/lib/workflow";
import { CheckCircle2, ChevronDown, FileText, Gavel, ListChecks, ShieldCheck, ArrowUpRight, AlertTriangle } from "lucide-react";
import { TrustBadge } from "@/components/trust-badge";
import { recordAppealUpheld } from "@/app/actions/trust";
import { getTrustBreakdown, trustTone, trustLabel } from "@/lib/trust";
import { ensureAiSummary } from "@/lib/ocr";
import { activeCaseCount } from "@/lib/assignment";
import { ChatContextSetter } from "@/components/chat-widget";
import { LetterButton } from "@/components/letter-dialog";
import { LETTER_META, type LetterType } from "@/lib/letters";
import { AiBadge } from "@/components/ai-badge";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "evc", label: "EVC" },
  { key: "undertakings", label: "Undertakings" },
  { key: "documents", label: "Documents" },
  { key: "timeline", label: "Timeline & audit" },
];

export default async function CaseFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "overview";

  const app = await getCaseFile(id);
  if (!app) notFound();

  // Row-level access check (defence in depth alongside the query scope).
  if (user.role === "INSTITUTION" && app.institutionId !== user.institutionId) redirect("/applications");
  if (!["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role) && user.role !== "INSTITUTION" && app.regionId !== user.regionId) {
    redirect("/applications");
  }

  const priority = casePriority(app);
  const route = parseStringArray(app.routeSnapshot);
  const slas = parseNumberMap(app.slaSnapshot);
  const actions = availableActions({ role: user.role, stage: app.currentStage, evcStatus: app.evcVisit?.status });
  const documents = await db.document.findMany({ where: { institutionId: app.institutionId }, orderBy: { expiresAt: "asc" } });
  const officers = await db.user.findMany({
    where: { role: "SCRUTINY_OFFICER", regionId: app.regionId },
    select: { id: true, name: true, maxActiveCases: true },
  });
  // Feature 5 — show the live load so "assign anyway" is a deliberate act.
  const officerLoads = await Promise.all(
    officers.map(async (o) => ({ ...o, active: await activeCaseCount(o.id, "SCRUTINY_OFFICER") })),
  );
  const latestAudit = await db.auditLog.findFirst({
    where: { entityType: "Application", entityId: app.id },
    orderBy: { createdAt: "desc" },
    select: { hash: true },
  });

  const pendingUndertakings = app.undertakings.filter((u) => ["PENDING", "OVERDUE", "ESCALATED"].includes(u.status));
  const trust = await getTrustBreakdown(app.institutionId, 6);
  const letters = await db.letter.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" } });
  const docSummaries = await Promise.all(
    documents.map(async (d) => ({ doc: d, summary: await ensureAiSummary(d) })),
  );

  return (
    <div>
      <ChatContextSetter
        value={{
          entityType: "Application",
          entityId: app.id,
          label: app.refNumber,
          detail: `stage: ${app.currentStage}, trust score: ${app.institution.trustScore}`,
        }}
      />
      {/* ---------------- header ---------------- */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-xl font-bold tracking-tight text-navy">{app.refNumber}</h1>
            <StatusPill status={app.status} />
            <SlaChip dueAt={app.dueAt} />
            <PriorityBadge score={priority.score} band={priority.band} reasons={priority.reasons} />
            {app.escalationLevel > 0 ? <Pill tone="red">Escalation level {app.escalationLevel}</Pill> : null}
            {(app.institution as { status?: string }).status && (app.institution as { status?: string }).status !== "ACTIVE" ? (
              <Pill tone={(app.institution as { status?: string }).status === "SUSPENDED" ? "red" : "amber"}>
                Institution {(app.institution as { status?: string }).status?.replace(/_/g, " ")}
              </Pill>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-ink-soft">
            <span className="font-medium text-ink">{app.institution.name}</span>
            <TrustBadge institutionId={app.institutionId} score={app.institution.trustScore} name={app.institution.name} size="md" />{" "}
            · {app.institution.city},{" "}
            {app.institution.state} · {app.region.name} Region · AISHE {app.institution.aisheCode}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {APP_TYPES[app.type as keyof typeof APP_TYPES] ?? app.type} · Submitted {fmtDateTime(app.submittedAt)} ·
            Pending {daysSince(app.submittedAt)} day(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/applications" className="btn-secondary btn-sm">
            Back to list
          </Link>
          <PrintButton label="Print case summary" />
        </div>
      </div>

      <Card className="mb-5">
        <CardHeader
          title="Approval route"
          subtitle={`${app.routeTemplate?.name ?? "Custom route"} · version ${app.routeVersion ?? 1} · SLA snapshot taken at submission`}
          action={<span className="chip tnum">Stage entered {fmtDate(app.stageEnteredAt)}</span>}
        />
        <StageStepper route={route} currentStage={app.currentStage} status={app.status} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr,340px]">
        {/* ---------------- main column ---------------- */}
        <div>
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <Link
                  key={t.key}
                  href={`/applications/${app.id}?tab=${t.key}`}
                  className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                    active ? "border-indigo-600 text-indigo-700" : "border-transparent text-ink-soft hover:text-ink"
                  }`}
                >
                  {t.label}
                  {t.key === "undertakings" && pendingUndertakings.length ? (
                    <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                      {pendingUndertakings.length}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>

          {tab === "overview" ? (
            <div className="space-y-5">
              <Card>
                <CardHeader title="Case particulars" />
                <KeyValue
                  items={[
                    { label: "Application type", value: APP_TYPES[app.type as keyof typeof APP_TYPES] ?? app.type },
                    { label: "Programme / course", value: app.programName || "—" },
                    { label: "Requested intake", value: app.intake || "—" },
                    { label: "Institution type", value: app.institution.type },
                    { label: "Current stage", value: shortStage(app.currentStage) },
                    { label: "Stage owner", value: (STAGES as Record<string, { owner: string | null }>)[app.currentStage]?.owner?.replace(/_/g, " ") ?? "—" },
                    { label: "Handling officer", value: app.assignedTo?.name ?? "Unassigned" },
                    { label: "Stage SLA", value: app.dueAt ? fmtDate(app.dueAt) : "Not applicable" },
                    { label: "Decided on", value: app.decidedAt ? fmtDateTime(app.decidedAt) : "—" },
                  ]}
                />
              </Card>

              <Card>
                <CardHeader
                  title="Rule version in force for this case"
                  subtitle="Applications are bound to the route and SLAs they were filed under"
                />
                <Table>
                  <THead>
                    <TR>
                      <TH>Stage</TH>
                      <TH>SLA (days)</TH>
                      <TH>Stage owner</TH>
                      <TH>State</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {route.map((s) => {
                      const idx = route.indexOf(s);
                      const currentIdx = route.indexOf(effectiveStage(app.currentStage as never));
                      return (
                        <TR key={s}>
                          <TD className="font-medium">{shortStage(s)}</TD>
                          <TD className="tnum">{slas[s] ?? "—"}</TD>
                          <TD className="text-xs">{(STAGES as Record<string, { owner: string | null }>)[s]?.owner?.replace(/_/g, " ") ?? "—"}</TD>
                          <TD>
                            {idx < currentIdx || ["APPROVED", "CONDITIONALLY_APPROVED", "REJECTED"].includes(app.status) ? (
                              <Pill tone="green">Done</Pill>
                            ) : idx === currentIdx ? (
                              <Pill tone="indigo">Current</Pill>
                            ) : (
                              <Pill tone="slate">Upcoming</Pill>
                            )}
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
                <p className="hint mt-3">
                  This snapshot was taken when the case was filed. Publishing a new version of the Approval Process
                  Handbook never re-routes an in-flight application — new applicants follow the new rules, existing
                  cases keep the ones they were judged against.
                </p>
              </Card>

              {app.decisionNote ? (
                <Card>
                  <CardHeader title="Decision note" subtitle="Recorded by the Competent Authority" />
                  <p className="text-sm leading-relaxed text-ink">{app.decisionNote}</p>
                </Card>
              ) : null}
            </div>
          ) : null}

          {tab === "evc" ? (
            <Card>
              <CardHeader
                title="Expert Visit Committee"
                action={app.evcVisit ? <Link href={`/evc/${app.evcVisit.id}`} className="btn-secondary btn-sm">Open visit<ArrowUpRight className="h-3.5 w-3.5" /></Link> : null}
              />
              {app.evcVisit ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <EvcStatusPill status={app.evcVisit.status} />
                    <SlaChip dueAt={app.evcVisit.dueAt} />
                    {app.evcVisit.recommendation ? (
                      <Pill tone={app.evcVisit.recommendation === "SATISFACTORY" ? "green" : "red"}>
                        {app.evcVisit.recommendation}
                      </Pill>
                    ) : null}
                  </div>
                  <KeyValue
                    items={[
                      {
                        label: "Scheduled for",
                        value: app.evcVisit.scheduledFor ? fmtDateTime(app.evcVisit.scheduledFor) : "Not scheduled",
                      },
                      { label: "Visit SLA", value: app.evcVisit.dueAt ? fmtDate(app.evcVisit.dueAt) : "—" },
                      { label: "Report filed", value: app.evcVisit.completedAt ? fmtDateTime(app.evcVisit.completedAt) : "—" },
                      { label: "Panel", value: <Members members={app.evcVisit.members} /> },
                    ]}
                  />
                  {app.evcVisit.reportText ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        Inspection note
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{app.evcVisit.reportText}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-faint">No inspection report filed yet.</p>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={<Gavel className="h-7 w-7" />}
                  title="No inspection required on this route"
                  hint="This application's route does not include an Expert Visit Committee stage."
                />
              )}
            </Card>
          ) : null}

          {tab === "undertakings" ? (
            <Card>
              <CardHeader title="Undertakings & deficiencies" subtitle="Each item has its own deadline, reminders and escalation path" />
              {app.undertakings.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Item</TH>
                      <TH>Phase</TH>
                      <TH>Due</TH>
                      <TH>Status</TH>
                      <TH>Proof</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {app.undertakings.map((u) => {
                      const last = u.submissions[0];
                      return (
                        <TR key={u.id}>
                          <TD>
                            <p className="text-[13px] font-medium">{u.title}</p>
                            {u.description ? (
                              <p className="max-w-[320px] truncate text-[11px] text-ink-faint">{u.description}</p>
                            ) : null}
                          </TD>
                          <TD>
                            <Pill tone={u.phase === "PRE" ? "amber" : "indigo"}>
                              {u.phase === "PRE" ? "Deficiency" : "Condition"}
                            </Pill>
                          </TD>
                          <TD className="tnum text-xs">{fmtDate(u.dueAt)}</TD>
                          <TD>
                            <UndertakingStatusPill status={u.status} />
                          </TD>
                          <TD>
                            {last ? <DocChip fileName={last.fileName} /> : <span className="text-xs text-ink-faint">—</span>}
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
              ) : (
                <EmptyState icon={<ListChecks className="h-7 w-7" />} title="No undertakings recorded" />
              )}
            </Card>
          ) : null}

          {tab === "documents" ? (
            <Card>
              <CardHeader title="Institution document register" subtitle="Validity is watched continuously" />
              {documents.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Document</TH>
                      <TH>File</TH>
                      <TH>Valid till</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {documents.map((d) => (
                      <TR key={d.id}>
                        <TD>{d.type.replace(/_/g, " ")}</TD>
                        <TD>
                          <DocChip fileName={d.fileName} />
                        </TD>
                        <TD className="tnum text-xs">{fmtDate(d.expiresAt)}</TD>
                        <TD>
                          <DocStatusPill status={d.status} />
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState icon={<FileText className="h-7 w-7" />} title="No documents registered" />
              )}
            </Card>
          ) : null}

          {tab === "timeline" ? (
            <div className="space-y-5">
              <Card>
                <CardHeader title="Case movement" subtitle="Every transition, with the reason recorded" />
                <CaseTimeline items={app.transitions} />
              </Card>
              <Card>
                <CardHeader title="Chain of custody" subtitle="Append-only audit trail for this case file" />
                <AuditList applicationId={app.id} />
              </Card>
            </div>
          ) : null}
        </div>

        {/* ---------------- right rail ---------------- */}
        <div className="space-y-5">
          <Card className="lg:sticky lg:top-[76px]">
            <CardHeader title="Auto case summary" subtitle="Generated from live data — no officer writes this" />
            <div className="space-y-3 text-[13px] leading-relaxed text-ink-soft">
              <p>
                <span className="font-semibold text-ink">{app.institution.name}</span> filed this application for{" "}
                <span className="font-semibold text-ink">{APP_TYPES[app.type as keyof typeof APP_TYPES] ?? app.type}</span> on{" "}
                {fmtDate(app.submittedAt)}. It is currently at{" "}
                <span className="font-semibold text-ink">{shortStage(app.currentStage)}</span>
                {app.assignedTo ? ` with ${app.assignedTo.name}` : " (unassigned)"}.
              </p>
              <p>
                {app.dueAt
                  ? daysUntil(app.dueAt) >= 0
                    ? `The stage SLA expires in ${daysUntil(app.dueAt)} day(s).`
                    : `The stage SLA expired ${Math.abs(daysUntil(app.dueAt))} day(s) ago and the case is at escalation level ${app.escalationLevel}.`
                  : "This case has been disposed of; no SLA is running."}
              </p>
              {pendingUndertakings.length ? (
                <p>
                  <span className="font-semibold text-ink">{pendingUndertakings.length}</span> compliance item(s) are
                  open, the oldest due{" "}
                  {fmtDate(pendingUndertakings.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0].dueAt)}.
                </p>
              ) : null}
              {app.evcVisit ? (
                <p>
                  Inspection status: <span className="font-semibold text-ink">{app.evcVisit.status}</span>
                  {app.evcVisit.scheduledFor ? `, scheduled ${fmtDate(app.evcVisit.scheduledFor)}` : ""}.
                </p>
              ) : null}
              {app.transitions[0] ? (
                <p className="border-t border-slate-100 pt-3 text-xs">
                  Last action: {app.transitions[0].action.replace(/_/g, " ").toLowerCase()} by{" "}
                  {app.transitions[0].actorName} on {fmtDateTime(app.transitions[0].createdAt)}.
                </p>
              ) : null}
              {latestAudit ? (
                <p className="font-mono text-[10px] text-ink-faint">head hash {latestAudit.hash.slice(0, 16)}…</p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Actions available to you" subtitle={`Signed in as ${user.role.replace(/_/g, " ").toLowerCase()}`} />
            {actions.length ? (
              <ul className="space-y-2">
                {actions.map((a) => (
                  <li key={a}>
                    <Link
                      href={`/applications/${app.id}/act/${a}`}
                      className={
                        a === "REJECT"
                          ? "btn-danger btn-sm w-full"
                          : a === "REVERT"
                            ? "btn-secondary btn-sm w-full"
                            : "btn-primary btn-sm w-full"
                      }
                    >
                      {a === "APPROVE_STAGE" ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}
                      {a === "REVERT" ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                      {a === "APPROVE" || a === "CONDITIONAL_APPROVE" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                      {a === "REJECT" ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                      {a === "RESUBMIT" ? <FileText className="h-3.5 w-3.5" /> : null}
                      {labelForAction(a, app.currentStage)}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center">
                <ShieldCheck className="mx-auto mb-2 h-5 w-5 text-slate-400" />
                <p className="text-xs font-medium text-ink">No action for your role here</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                  This case sits at {shortStage(app.currentStage)}. Statutory decisions are taken only by the owning
                  officer — supervisors act through the escalation ladder, never by overriding.
                </p>
              </div>
            )}

            {["REGIONAL_OFFICER", "BUREAU_OFFICER", "SYSTEM_ADMIN", "SCRUTINY_OFFICER"].includes(user.role) &&
            !["APPROVED", "REJECTED", "CONDITIONALLY_APPROVED"].includes(app.status) ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="label">Re-assign handling officer</p>
                <ActionForm
                  action={assignApplication}
                  hidden={{ applicationId: app.id }}
                  submitLabel="Assign"
                  variant="btn-secondary btn-sm"
                  className="space-y-2"
                >
                  <select name="assignedToId" className="select" defaultValue={app.assignedToId ?? ""}>
                    <option value="">Unassigned</option>
                    {officerLoads.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} — {o.active}/{o.maxActiveCases} active{o.active >= o.maxActiveCases ? " (at capacity)" : ""}
                      </option>
                    ))}
                  </select>
                  <textarea
                    name="reason"
                    rows={2}
                    className="textarea min-h-[56px]"
                    placeholder="Reason — required if the officer is already at their workload cap"
                  />
                </ActionForm>
              </div>
            ) : null}
          </Card>

          {["SCRUTINY_OFFICER", "COMPLIANCE_OFFICER", "REGIONAL_OFFICER", "COMPETENT_AUTHORITY", "SYSTEM_ADMIN"].includes(user.role) ? (
            <>
          {/* Feature 8 — auto-drafted letters */}
          <Card>
            <CardHeader
              title="Letters"
              subtitle="Drafts are generated from this case file — only an officer can issue one"
            />
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LETTER_META) as LetterType[]).map((t) => (
                <LetterButton key={t} applicationId={app.id} type={t} label={LETTER_META[t].label} />
              ))}
            </div>
            {letters.length ? (
              <ul className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                {letters.map((l) => (
                  <li key={l.id} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="text-[12px] font-semibold text-ink">{LETTER_META[l.type as LetterType]?.label ?? l.type}</p>
                    <p className="mt-0.5 text-[11px] text-ink-soft">{l.subject}</p>
                    <p className="mt-1 text-[10px] text-ink-faint">
                      Sent by {l.sentBy ?? l.reviewedBy ?? "—"} · {fmtDateTime(l.sentAt ?? l.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[11px] text-ink-faint">No letters issued on this case yet.</p>
            )}
          </Card>

            </>
          ) : null}

          {/* Feature 3 — AI document summaries, collapsed by default */}
          {docSummaries.some((d) => d.summary) ? (
            <Card>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-xl">
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-navy">
                      AI Document Summaries
                      <AiBadge label="AI-generated" />
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {docSummaries.length} document(s) read automatically — advisory only
                    </span>
                  </span>
                  <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                </summary>

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                  {docSummaries.map(({ doc, summary }) =>
                    summary ? (
                      <div key={doc.id} className="rounded-lg border border-slate-200 p-3">
                        <p className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                          {DOC_TYPE_LABELS[doc.type] ?? doc.type.replace(/_/g, " ")}
                          <span className="chip tnum">
                            {summary.engine === "MOCK" ? "demo reader" : summary.engine.toLowerCase()}
                          </span>
                        </p>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">{summary.summary}</p>
                        {summary.keyDates.length ? (
                          <ul className="mt-2 space-y-0.5">
                            {summary.keyDates.slice(0, 4).map((k, i) => (
                              <li key={i} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-ink-faint">{k.label}</span>
                                <span className="font-mono tnum text-ink-soft">{k.date}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <p className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-1.5 text-[10px] text-ink-faint">
                          <AiBadge label="AI-generated" />
                          Machine reading — an officer must verify against the original before relying on it.
                        </p>
                      </div>
                    ) : null,
                  )}
                </div>
              </details>
            </Card>
          ) : null}

          {/* Feature 1 — trust score, event sourced */}
          <Card>
            <CardHeader
              title="Compliance trust score"
              subtitle="Advisory only — never used to suspend or reject on its own"
            />
            {trust ? (
              <div>
                <div className="mb-3 flex items-baseline gap-2">
                  <span
                    className={`text-3xl font-bold tnum ${
                      trustTone(trust.score) === "green"
                        ? "text-emerald-600"
                        : trustTone(trust.score) === "amber"
                        ? "text-amber-600"
                        : "text-red-600"
                    }`}
                  >
                    {trust.score}
                  </span>
                  <span className="text-xs text-ink-faint">/ 100 · {trustLabel(trust.score)}</span>
                  <span className="ml-auto">
                    <TrustBadge institutionId={app.institutionId} score={trust.score} name={app.institution.name} size="md" />
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      trustTone(trust.score) === "green" ? "bg-emerald-500" : trustTone(trust.score) === "amber" ? "bg-amber-500" : "bg-red-500"
                    }`}
                    style={{ width: `${trust.score}%` }}
                  />
                </div>

                {trust.byType.length ? (
                  <ul className="mt-3 space-y-1">
                    {trust.byType.map((t) => (
                      <li key={t.event} className="flex items-center gap-2 text-[12px]">
                        <span className="min-w-0 flex-1 truncate text-ink-soft">{t.label}</span>
                        <span className="chip tnum">×{t.count}</span>
                        <span className={`w-10 text-right font-mono font-semibold tnum ${t.total < 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {t.total > 0 ? `+${t.total}` : t.total}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[12px] text-ink-faint">No events recorded — starting score of 100.</p>
                )}

                {trust.events.length ? (
                  <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                    {trust.events.slice(0, 4).map((e) => (
                      <li key={e.id} className="text-[11px]">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-ink">{e.label}</span>
                          <span className={`font-mono font-bold tnum ${e.delta < 0 ? "text-red-600" : "text-emerald-600"}`}>
                            {e.delta > 0 ? `+${e.delta}` : e.delta}
                          </span>
                        </div>
                        {e.note ? <p className="truncate text-ink-faint">{e.note}</p> : null}
                        <p className="text-ink-faint">{fmtDate(e.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {["REGIONAL_OFFICER", "BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN"].includes(user.role) ? (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="label">Record appeal outcome (+5)</p>
                    <ActionForm
                      action={recordAppealUpheld}
                      hidden={{ institutionId: app.institutionId, applicationId: app.id }}
                      submitLabel="Record appeal upheld"
                      variant="btn-secondary btn-sm"
                      className="space-y-2"
                      confirm="Record that this institution's appeal was upheld?"
                    >
                      <textarea
                        name="note"
                        rows={2}
                        className="input"
                        placeholder="Basis on which the appeal was upheld"
                        required
                      />
                    </ActionForm>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>

          {app.escalationLevel > 0 ? (
            <div>
              <Banner tone="red" title={`Escalated to level ${app.escalationLevel}`}>
                The deadline engine raised this case automatically. It now appears on the Regional Officer's desk.
              </Banner>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function labelForAction(action: string, stage: string) {
  const map: Record<string, string> = {
    APPROVE_STAGE: `Complete ${shortStage(stage)} & forward`,
    REVERT: "Raise deficiency (revert)",
    RESUBMIT: "Submit reply to AICTE",
    APPROVE: "Approve application",
    CONDITIONAL_APPROVE: "Conditionally approve",
    REJECT: "Reject application",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

async function AuditList({ applicationId }: { applicationId: string }) {
  const rows = await db.auditLog.findMany({
    where: { entityType: "Application", entityId: applicationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  if (!rows.length) return <p className="text-sm text-ink-faint">No audit entries yet.</p>;

  return (
    <Table>
      <THead>
        <TR>
          <TH>Time</TH>
          <TH>Action</TH>
          <TH>Actor</TH>
          <TH>Hash</TH>
        </TR>
      </THead>
      <tbody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="text-xs">{fmtDateTime(r.createdAt)}</TD>
            <TD className="text-xs font-medium">{r.action.replace(/_/g, " ")}</TD>
            <TD className="text-xs">{r.actorName}</TD>
            <TD className="font-mono text-[10px] text-ink-faint">{r.hash.slice(0, 12)}…</TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}
