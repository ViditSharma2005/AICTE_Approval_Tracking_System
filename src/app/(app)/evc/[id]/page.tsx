import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ChatContextSetter } from "@/components/chat-widget";
import { db } from "@/lib/db";
import { scopeFor } from "@/lib/rbac";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader, KeyValue } from "@/components/ui";
import { EvcStatusPill, Members, SlaChip } from "@/components/case";
import { ActionForm } from "@/components/forms";
import { scheduleEvc, fileEvcReport } from "@/app/actions/evc";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function EvcDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const evc = await db.evcVisit.findUnique({
    where: { id },
    include: {
      application: {
        include: { institution: { select: { name: true, city: true, state: true } }, region: true },
      },
    },
  });
  if (!evc) notFound();

  // scope check
  const visible = await db.evcVisit.count({ where: { id, application: scopeFor(user) } });
  if (!visible && user.role === "INSTITUTION") notFound();

  const experts = await db.user.findMany({
    where: { role: { in: ["EVC_MEMBER", "EVC_COORDINATOR", "COMMITTEE_MEMBER"] }, regionId: evc.application.regionId },
    select: { id: true, name: true, role: true, designation: true },
  });

  const canSchedule = ["EVC_COORDINATOR", "REGIONAL_OFFICER", "SYSTEM_ADMIN"].includes(user.role);
  const canReport = ["EVC_COORDINATOR", "EVC_MEMBER", "SYSTEM_ADMIN"].includes(user.role);
  const selected: string[] = JSON.parse(evc.members || "[]");

  return (
    <>
      <ChatContextSetter value={{ entityType: "EVC visit", entityId: evc.id, label: evc.application.refNumber, detail: `status: ${evc.status}` }} />
      <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Inspection · ${evc.application.refNumber}`}
        subtitle={`${evc.application.institution.name} · ${evc.application.institution.city}, ${evc.application.institution.state}`}
        actions={
          <Link href={`/applications/${evc.applicationId}`} className="btn-secondary btn-sm">
            Open case file
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr,340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Visit status" />
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <EvcStatusPill status={evc.status} />
              <SlaChip dueAt={evc.dueAt} />
              {evc.recommendation ? (
                <span className={evc.recommendation === "SATISFACTORY" ? "text-xs font-semibold text-emerald-700" : "text-xs font-semibold text-red-700"}>
                  {evc.recommendation}
                </span>
              ) : null}
            </div>
            <KeyValue
              items={[
                { label: "Queued on", value: fmtDateTime(evc.createdAt) },
                { label: "Scheduled for", value: evc.scheduledFor ? fmtDateTime(evc.scheduledFor) : "Not scheduled" },
                { label: "Visit SLA", value: evc.dueAt ? fmtDateTime(evc.dueAt) : "—" },
                { label: "Report filed", value: evc.completedAt ? fmtDateTime(evc.completedAt) : "—" },
                { label: "Panel", value: <Members members={evc.members} /> },
                { label: "Programme", value: evc.application.programName || "—" },
              ]}
            />
          </Card>

          {evc.reportText ? (
            <Card>
              <CardHeader title="Inspection note" subtitle={`Filed by ${evc.application.institution.name} visit team`} />
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{evc.reportText}</p>
            </Card>
          ) : null}

          {canReport && evc.status !== "COMPLETED" ? (
            <Card>
              <CardHeader title="File inspection report" subtitle="The EVC stage cannot be closed until a report is filed" />
              <ActionForm
                action={fileEvcReport}
                hidden={{ evcId: evc.id }}
                submitLabel="File report"
                pendingLabel="Filing…"
              >
                <div>
                  <label className="label">Recommendation</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      { v: "SATISFACTORY", label: "Satisfactory — recommend forward", tone: "border-emerald-300 bg-emerald-50" },
                      { v: "DEFICIENT", label: "Deficient — revert to institution", tone: "border-red-300 bg-red-50" },
                    ].map((opt) => (
                      <label
                        key={opt.v}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${opt.tone}`}
                      >
                        <input type="radio" name="recommendation" value={opt.v} defaultChecked={opt.v === "SATISFACTORY"} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">Inspection note</label>
                  <textarea
                    name="reportText"
                    className="textarea min-h-[140px]"
                    placeholder="Infrastructure observed, faculty present, laboratory readiness, documents verified on site…"
                    required
                  />
                </div>
              </ActionForm>
            </Card>
          ) : null}
        </div>

        <div>
          {canSchedule ? (
            <Card>
              <CardHeader title="Constitute & schedule" subtitle="Members are notified the moment you confirm" />
              <ActionForm
                action={scheduleEvc}
                hidden={{ evcId: evc.id }}
                submitLabel={evc.status === "SCHEDULED" ? "Reschedule visit" : "Schedule visit"}
                pendingLabel="Scheduling…"
              >
                <div>
                  <label className="label">Date & time of visit</label>
                  <input
                    type="datetime-local"
                    name="scheduledFor"
                    className="input"
                    required
                    defaultValue={
                      evc.scheduledFor ? new Date(evc.scheduledFor).toISOString().slice(0, 16) : undefined
                    }
                  />
                </div>
                <div>
                  <label className="label">Mode of inspection</label>
                  <select name="visitMode" className="select" defaultValue="PHYSICAL">
                    <option value="PHYSICAL">Physical inspection</option>
                    <option value="HYBRID">Hybrid (physical + virtual)</option>
                    <option value="VIRTUAL">Virtual inspection</option>
                  </select>
                </div>
                <div>
                  <label className="label">Committee members</label>
                  {experts.length ? (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
                      {experts.map((e) => (
                        <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                          <input
                            type="checkbox"
                            name="members"
                            value={e.id}
                            defaultChecked={selected.includes(e.id)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                          />
                          <span className="min-w-0 flex-1 truncate">{e.name}</span>
                          <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                            {e.role.replace(/_/g, " ")}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-ink-faint">No experts registered in this region yet.</p>
                  )}
                </div>
              </ActionForm>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Read-only" />
              <p className="text-xs leading-relaxed text-ink-soft">
                {user.role === "INSTITUTION"
                  ? "Your institution will be notified as soon as the visiting committee is constituted and the date is fixed."
                  : "Only the EVC coordinator can constitute the committee and fix the visit date."}
              </p>
            </Card>
          )}

          {evc.status === "OVERDUE" ? (
            <div className="mt-4">
              <Banner tone="red" title="Visit overdue">
                This inspection has crossed its SLA and has been escalated to the Regional Officer. Schedule it now to
                stop the escalation ladder.
              </Banner>
            </div>
          ) : null}
        </div>
      </div>
    </div>
    </>
  );
}
