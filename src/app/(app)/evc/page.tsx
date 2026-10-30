import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { scopeFor } from "@/lib/rbac";
import { PageHeader } from "@/components/app-shell";
import { Card, CardHeader, EmptyState, TD, TH, THead, TR, Table } from "@/components/ui";
import { EvcStatusPill, Members, SlaChip } from "@/components/case";
import { ClipboardCheck } from "lucide-react";
import { fmtDateTime } from "@/lib/time";
import { TrustBadge } from "@/components/trust-badge";
import { AutoAllocateButton } from "@/components/evc-allocate";

export const dynamic = "force-dynamic";

export default async function EvcPage() {
  const user = await requireUser();

  const visits = await db.evcVisit.findMany({
    where: { application: scopeFor(user) },
    include: {
      application: {
        select: {
          id: true,
          refNumber: true,
          programName: true,
          currentStage: true,
          institution: { select: { id: true, name: true, city: true, trustScore: true } },
          region: { select: { name: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
  });

  const canAllocate = ["EVC_COORDINATOR", "SYSTEM_ADMIN"].includes(user.role);
  const order = { OVERDUE: 0, QUEUED: 1, SCHEDULED: 2, COMPLETED: 3 } as Record<string, number>;
  const rows = [...visits].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return (
    <div>
      <PageHeader
        title="Expert Visit Committee"
        subtitle="Every inspection is a task with a deadline: queue → schedule → report → close"
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        {[
          { label: "Overdue", value: visits.filter((v) => v.status === "OVERDUE").length, tone: "red" as const },
          { label: "Queued", value: visits.filter((v) => v.status === "QUEUED").length, tone: "slate" as const },
          { label: "Scheduled", value: visits.filter((v) => v.status === "SCHEDULED").length, tone: "blue" as const },
          { label: "Completed", value: visits.filter((v) => v.status === "COMPLETED").length, tone: "green" as const },
        ].map((s) => (
          <Card key={s.label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{s.label}</p>
            <p className="mt-1 text-2xl font-bold text-ink tnum">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Inspection register" subtitle="Visits are queued automatically when a case enters the EVC stage" />
        </div>
        {rows.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Institution</TH>
                <TH>Status</TH>
                <TH>Scheduled</TH>
                <TH>Panel</TH>
                <TH>Visit SLA</TH>
                <TH>Recommendation</TH>
              </TR>
            </THead>
            <tbody>
              {rows.map((v) => (
                <TR key={v.id}>
                  <TD>
                    <Link href={`/evc/${v.id}`} className="link font-mono text-xs">
                      {v.application.refNumber}
                    </Link>
                    <p className="mt-0.5 max-w-[200px] truncate text-[11px] text-ink-faint">
                      {v.application.programName || "—"}
                    </p>
                  </TD>
                  <TD className="max-w-[200px]">
                    <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                        <span className="truncate">{v.application.institution.name}</span>
                        <TrustBadge institutionId={v.application.institution.id} score={v.application.institution.trustScore} name={v.application.institution.name} />
                      </p>
                    <p className="text-[11px] text-ink-faint">
                      {v.application.institution.city} · {v.application.region.name}
                    </p>
                  </TD>
                  <TD>
                    <EvcStatusPill status={v.status} />
                  </TD>
                  <TD className="text-xs">{v.scheduledFor ? fmtDateTime(v.scheduledFor) : "—"}</TD>
                  <TD>
                    <Members members={v.members} />
                    {v.allocatedAt ? (
                      <p className="mt-1 text-[11px] text-ink-faint">Allocated by {v.allocatedBy ?? "coordinator"}</p>
                    ) : null}
                    {canAllocate && ["QUEUED", "SCHEDULED", "OVERDUE"].includes(v.status) ? (
                      <div className="mt-2">
                        <AutoAllocateButton visitId={v.id} />
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <SlaChip dueAt={v.dueAt} />
                  </TD>
                  <TD>
                    {v.recommendation ? (
                      <span className={v.recommendation === "SATISFACTORY" ? "text-xs font-semibold text-emerald-700" : "text-xs font-semibold text-red-700"}>
                        {v.recommendation}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={<ClipboardCheck className="h-7 w-7" />}
              title="No inspections in your scope"
              hint="Visits appear here the moment a case file enters the Expert Visit Committee stage."
            />
          </div>
        )}
      </Card>
    </div>
  );
}
