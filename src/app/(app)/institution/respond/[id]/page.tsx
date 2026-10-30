import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ChatContextSetter } from "@/components/chat-widget";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader, KeyValue } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { respondToUndertaking } from "@/app/actions/undertaking";
import { DocChip, SlaChip, UndertakingStatusPill } from "@/components/case";
import { fmtDate, fmtDateTime, daysUntil } from "@/lib/time";
import { CheckCircle2, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RespondPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user.role !== "INSTITUTION") redirect("/undertakings");

  const { id } = await params;
  const u = await db.undertaking.findUnique({
    where: { id },
    include: {
      submissions: { orderBy: { submittedAt: "desc" } },
      application: { select: { id: true, refNumber: true, currentStage: true } },
      institution: { select: { name: true, city: true } },
    },
  });

  if (!u) notFound();
  if (u.institutionId !== user.institutionId) redirect("/undertakings");

  const days = daysUntil(u.dueAt);
  const canRespond = ["PENDING", "OVERDUE", "ESCALATED"].includes(u.status);

  return (
    <>
      <ChatContextSetter value={{ entityType: "Undertaking", entityId: u.id, label: u.title, detail: `${u.phase === "PRE" ? "deficiency" : "condition"} — due ${fmtDate(u.dueAt)}` }} />
      <div className="mx-auto max-w-3xl">
      <PageHeader
        title={u.title}
        subtitle={`${u.institution.name} · ${u.phase === "PRE" ? "Deficiency raised during processing" : "Condition of approval"}`}
        actions={
          u.application ? (
            <Link href={`/applications/${u.application.id}`} className="btn-secondary btn-sm">
              Open case file
            </Link>
          ) : null
        }
      />

      {u.status === "VERIFIED" ? (
        <div className="mb-5">
          <Banner tone="green" title="Compliance verified">
            {u.verifiedBy} verified your submission on {u.verifiedAt ? fmtDateTime(u.verifiedAt) : "—"}. No further
            action is required.
          </Banner>
        </div>
      ) : null}

      {days < 0 && canRespond ? (
        <div className="mb-5">
          <Banner tone="red" title={`Overdue by ${Math.abs(days)} day(s)`}>
            This item has been escalated to the Regional Officer. Submit your proof now to stop the escalation ladder.
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr,320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="What is required" />
            <p className="text-sm leading-relaxed text-ink">{u.description || "No further details were recorded."}</p>
            <div className="mt-4">
              <KeyValue
                items={[
                  { label: "Deadline", value: fmtDate(u.dueAt) },
                  { label: "Time left", value: <SlaChip dueAt={u.dueAt} /> },
                  { label: "Status", value: <UndertakingStatusPill status={u.status} /> },
                  {
                    label: "Linked application",
                    value: u.application ? (
                      <Link href={`/applications/${u.application.id}`} className="link font-mono text-xs">
                        {u.application.refNumber}
                      </Link>
                    ) : (
                      "—"
                    ),
                  },
                  { label: "Raised on", value: fmtDate(u.createdAt) },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Submission history" />
            {u.submissions.length ? (
              <ul className="space-y-3">
                {u.submissions.map((s) => (
                  <li key={s.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <DocChip fileName={s.fileName} />
                      <span
                        className={
                          s.status === "VERIFIED"
                            ? "text-[11px] font-semibold text-emerald-700"
                            : s.status === "REJECTED"
                              ? "text-[11px] font-semibold text-red-700"
                              : "text-[11px] font-semibold text-amber-700"
                        }
                      >
                        {s.status}
                      </span>
                    </div>
                    {s.note ? <p className="mt-1.5 text-xs text-ink-soft">{s.note}</p> : null}
                    <p className="mt-1 text-[11px] text-ink-faint">
                      Submitted by {s.submittedBy ?? "institution"} on {fmtDateTime(s.submittedAt)}
                      {s.verifiedBy ? ` · ${s.status.toLowerCase()} by ${s.verifiedBy}` : ""}
                    </p>
                    {s.rejectionNote ? (
                      <p className="mt-2 rounded border border-red-100 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                        {s.rejectionNote}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint">Nothing submitted yet.</p>
            )}
          </Card>
        </div>

        <div>
          {canRespond ? (
            <Card>
              <CardHeader title="Submit proof of compliance" subtitle="A compliance officer verifies every upload" />
              <ActionForm
                action={respondToUndertaking}
                hidden={{ undertakingId: u.id }}
                submitLabel="Submit to AICTE"
                pendingLabel="Uploading…"
              >
                <div>
                  <label className="label">Document / file reference</label>
                  <input name="fileName" className="input" placeholder="lease-deed-renewed-2027.pdf" required />
                </div>
                <div>
                  <label className="label">Note for the officer (optional)</label>
                  <textarea name="note" className="textarea min-h-[90px]" placeholder="Anything the verifying officer should know." />
                </div>
                {u.phase === "PRE" ? (
                  <p className="hint">
                    Submitting a deficiency reply automatically returns the case file to the scrutiny officer for
                    re-scrutiny — you do not need to do anything else.
                  </p>
                ) : null}
              </ActionForm>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Awaiting verification" />
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs leading-relaxed text-ink-soft">
                  Your submission is with the compliance officer. You will be notified the moment it is verified or
                  rejected.
                </p>
              </div>
            </Card>
          )}

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-xs leading-relaxed text-ink-soft">
                Reminders are sent automatically at 7 days, 2 days and on the due date. Nothing is decided by a
                machine — a compliance officer verifies every submission you make.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
