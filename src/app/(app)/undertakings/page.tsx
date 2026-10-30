import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Card, CardHeader, EmptyState, Pill, TD, TH, THead, TR, Table } from "@/components/ui";
import { DocChip, SlaChip, UndertakingStatusPill } from "@/components/case";
import { ActionForm } from "@/components/forms";
import { createUndertaking, verifySubmission } from "@/app/actions/undertaking";
import { ListChecks } from "lucide-react";
import { fmtDate, daysUntil } from "@/lib/time";
import { TrustBadge } from "@/components/trust-badge";

export const dynamic = "force-dynamic";

export default async function UndertakingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (user.role === "INSTITUTION") where.institutionId = user.institutionId ?? "__none__";
  else if (!["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)) {
    where.institution = { regionId: user.regionId ?? "__none__" };
  }

  const [undertakings, institutions] = await Promise.all([
    db.undertaking.findMany({
      where,
      include: {
        institution: { select: { id: true, name: true, city: true, trustScore: true } },
        application: { select: { id: true, refNumber: true } },
        submissions: { orderBy: { submittedAt: "desc" } },
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    }),
    db.institution.findMany({
      where:
        user.role === "INSTITUTION"
          ? { id: user.institutionId ?? "__none__" }
          : ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
            ? {}
            : { regionId: user.regionId ?? "__none__" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const counts = await db.undertaking.groupBy({
    by: ["status"],
    where:
      user.role === "INSTITUTION"
        ? { institutionId: user.institutionId ?? "__none__" }
        : ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role)
          ? {}
          : { institution: { regionId: user.regionId ?? "__none__" } },
    _count: { _all: true },
  });
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  const canVerify = ["COMPLIANCE_OFFICER", "SCRUTINY_OFFICER", "REGIONAL_OFFICER", "SYSTEM_ADMIN"].includes(user.role);
  const canCreate = canVerify;

  return (
    <div>
      <PageHeader
        title="Undertakings & deficiencies"
        subtitle="Every commitment an institution makes, tracked to closure — pre-approval deficiencies and post-approval conditions together"
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-5">
        {["PENDING", "SUBMITTED", "VERIFIED", "OVERDUE", "ESCALATED"].map((s) => (
          <Link key={s} href={status === s ? "/undertakings" : `/undertakings?status=${s}`}>
            <Card className={status === s ? "ring-2 ring-indigo-500" : ""}>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{s.replace(/_/g, " ")}</p>
              <p className="mt-1 text-2xl font-bold text-ink tnum">{countOf(s)}</p>
            </Card>
          </Link>
        ))}
      </div>

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Compliance register"
            subtitle="Reminders fire at 7 / 2 / 0 days; non-compliance climbs to the Regional Officer, then the Bureau"
          />
        </div>

        {undertakings.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Item</TH>
                <TH>Institution</TH>
                <TH>Linked case</TH>
                <TH>Phase</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                <TH>Proof / verification</TH>
              </TR>
            </THead>
            <tbody>
              {undertakings.map((u) => {
                const latest = u.submissions[0];
                return (
                  <TR key={u.id}>
                    <TD className="max-w-[260px]">
                      <p className="truncate text-[13px] font-semibold">{u.title}</p>
                      {u.description ? (
                        <p className="truncate text-[11px] text-ink-faint">{u.description}</p>
                      ) : null}
                    </TD>
                    <TD className="max-w-[180px]"><span className="flex items-center gap-1.5 truncate"><span className="truncate">{u.institution.name}</span><TrustBadge institutionId={u.institution.id} score={u.institution.trustScore} name={u.institution.name} /></span></TD>
                    <TD>
                      {u.application ? (
                        <Link href={`/applications/${u.application.id}`} className="link font-mono text-xs">
                          {u.application.refNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      <Pill tone={u.phase === "PRE" ? "amber" : "indigo"}>{u.phase === "PRE" ? "Deficiency" : "Condition"}</Pill>
                    </TD>
                    <TD className="tnum text-xs">
                      {fmtDate(u.dueAt)}
                      <p className="mt-0.5">
                        <SlaChip dueAt={u.dueAt} />
                      </p>
                    </TD>
                    <TD>
                      <UndertakingStatusPill status={u.status} />
                    </TD>
                    <TD>
                      {latest ? (
                        <div className="space-y-1">
                          <DocChip fileName={latest.fileName} />
                          <p className="text-[11px] text-ink-faint">
                            {latest.submittedAt.toLocaleDateString("en-IN", { dateStyle: "medium" })} ·{" "}
                            <span className="font-medium">{latest.status}</span>
                          </p>
                          {latest.rejectionNote ? (
                            <p className="text-[11px] text-red-600">Rejected: {latest.rejectionNote}</p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-faint">Not submitted</span>
                      )}

                      {user.role === "INSTITUTION" && u.status !== "VERIFIED" ? (
                        <Link href={`/institution/respond/${u.id}`} className="btn-primary btn-sm mt-2">
                          Respond
                        </Link>
                      ) : null}

                      {canVerify && latest && latest.status === "SUBMITTED" ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-semibold text-indigo-600 hover:underline">
                            Verify submission
                          </summary>
                          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <ActionForm
                              action={verifySubmission}
                              hidden={{ submissionId: latest.id }}
                              submitLabel="Verify"
                              variant="btn-success btn-sm"
                              pendingLabel="Verifying…"
                            >
                              <input type="hidden" name="decision" value="VERIFIED" />
                              <p className="text-[11px] text-ink-soft">
                                Marks the undertaking as complied with and closes the escalation path.
                              </p>
                            </ActionForm>
                            <div className="mt-3 border-t border-slate-200 pt-3">
                              <ActionForm
                                action={verifySubmission}
                                hidden={{ submissionId: latest.id, decision: "REJECTED" }}
                                submitLabel="Reject & ask again"
                                variant="btn-danger btn-sm"
                                pendingLabel="Recording…"
                              >
                                <textarea
                                  name="note"
                                  className="textarea min-h-[64px]"
                                  placeholder="Why is this proof insufficient?"
                                  required
                                />
                              </ActionForm>
                            </div>
                          </div>
                        </details>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={<ListChecks className="h-7 w-7" />}
              title="No undertakings in this view"
              hint="Undertakings appear when an officer raises a deficiency or records a conditional approval."
            />
          </div>
        )}
      </Card>

      {canCreate ? (
        <Card className="mt-5">
          <CardHeader title="Record a new compliance requirement" subtitle="Use this to place a tracked obligation on an institution" />
          <ActionForm action={createUndertaking} submitLabel="Create undertaking" pendingLabel="Creating…" className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Title</label>
              <input name="title" className="input" placeholder="e.g. Submit fire safety clearance" required />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Details</label>
              <textarea name="description" className="textarea min-h-[70px]" placeholder="What exactly must be done or uploaded?" />
            </div>
            <div>
              <label className="label">Institution</label>
              <select name="institutionId" className="select" required>
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Window</label>
                <select name="days" className="select" defaultValue="30">
                  {[7, 15, 30, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Phase</label>
                <select name="phase" className="select" defaultValue="POST">
                  <option value="POST">Condition of approval</option>
                  <option value="PRE">Pre-approval deficiency</option>
                </select>
              </div>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
