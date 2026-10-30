import Link from "next/link";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader, EmptyState, Pill, TD, TH, THead, TR, Table } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { resolveEscalationAction } from "@/app/actions/misc";
import { decideSuspensionRecommendation } from "@/app/actions/letters";
import { ShieldCheck, AlertTriangle, Gavel } from "lucide-react";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function EscalationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role === "INSTITUTION") {
    return (
      <div>
        <PageHeader title="Escalations" />
        <Banner tone="indigo" title="Not available">
          The escalation register is an internal supervisory view.
        </Banner>
      </div>
    );
  }

  const sp = await searchParams;
  const show = typeof sp.show === "string" ? sp.show : "OPEN";

  const escalations = await db.escalation.findMany({
    where: show === "ALL" ? {} : { status: show },
    orderBy: [{ status: "asc" }, { level: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  // Resolve entity ids to human labels
  const appIds = escalations.filter((e) => e.entityType === "APPLICATION").map((e) => e.entityId);
  const evcIds = escalations.filter((e) => e.entityType === "EVC").map((e) => e.entityId);
  const undIds = escalations.filter((e) => e.entityType === "UNDERTAKING").map((e) => e.entityId);
  const docIds = escalations.filter((e) => e.entityType === "DOCUMENT").map((e) => e.entityId);

  const [apps, evcs, unds, docs] = await Promise.all([
    db.application.findMany({ where: { id: { in: appIds } }, select: { id: true, refNumber: true, regionId: true, institution: { select: { name: true } } } }),
    db.evcVisit.findMany({ where: { id: { in: evcIds } }, include: { application: { select: { id: true, refNumber: true, regionId: true } } } }),
    db.undertaking.findMany({ where: { id: { in: undIds } }, select: { id: true, title: true, institution: { select: { name: true, regionId: true } } } }),
    db.document.findMany({ where: { id: { in: docIds } }, select: { id: true, type: true, institution: { select: { name: true, regionId: true } } } }),
  ]);

  const regionOf = new Map<string, string>();
  for (const a of apps) regionOf.set(a.id, a.regionId);
  for (const e of evcs) regionOf.set(e.id, e.application.regionId);
  for (const u of unds) regionOf.set(u.id, u.institution.regionId);
  for (const d of docs) regionOf.set(d.id, d.institution.regionId);

  const national = ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN"].includes(user.role);
  const visible = national ? escalations : escalations.filter((e) => !user.regionId || regionOf.get(e.entityId) === user.regionId);

  const open = visible.filter((e) => e.status === "OPEN");

  // Feature 8 — suspension recommendations awaiting the Competent Authority
  const tasks = await db.task.findMany({
    where: user.role === "COMPETENT_AUTHORITY" || user.role === "SYSTEM_ADMIN" ? {} : { id: "__none__" },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });
  const taskInst = await db.institution.findMany({
    where: { id: { in: tasks.map((t) => t.institutionId ?? "__none__") } },
    select: { id: true, name: true, city: true, state: true, status: true, trustScore: true },
  });

  return (
    <div>
      <PageHeader
        title="Escalation register"
        subtitle="Raised automatically by the deadline engine — never by an officer's discretion"
        actions={
          <>
            <Link href="/escalations?show=OPEN" className={`btn-sm ${show === "OPEN" ? "btn-navy" : "btn-secondary"}`}>
              Open ({open.length})
            </Link>
            <Link href="/escalations?show=ALL" className={`btn-sm ${show === "ALL" ? "btn-navy" : "btn-secondary"}`}>
              All
            </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((lvl) => (
          <Card key={lvl}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Level {lvl}</p>
              <AlertTriangle className={lvl >= 2 ? "h-4 w-4 text-red-500" : "h-4 w-4 text-amber-500"} />
            </div>
            <p className="mt-1 text-2xl font-bold text-ink tnum">{open.filter((e) => e.level === lvl).length}</p>
            <p className="hint">
              {lvl === 1 ? "Regional Officer notified" : lvl === 2 ? "Bureau Officer notified" : "Bureau Head — persistent default"}
            </p>
          </Card>
        ))}
      </div>

      {/* Feature 8 — the one place where suspension is decided */}
      {tasks.length ? (
        <Card className="mb-5" padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Suspension recommendations"
              subtitle="Raised by the engine when compliance fails persistently — only the Competent Authority can accept one"
              action={<span className="chip tnum">{tasks.filter((t) => t.status === "OPEN").length} open</span>}
            />
          </div>
          <div className="space-y-3 px-5 pb-5">
            {tasks.map((t) => {
              const inst = taskInst.find((i) => i.id === t.institutionId);
              return (
                <div
                  key={t.id}
                  className={`rounded-xl border p-4 ${
                    t.status === "OPEN" ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                        <Gavel className="h-4 w-4 text-red-600" />
                        {t.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        Raised {fmtDateTime(t.createdAt)} · {inst ? `${inst.city}, ${inst.state} · trust score ${inst.trustScore} · status ${inst.status}` : ""}
                      </p>
                    </div>
                    <Pill tone={t.status === "OPEN" ? "red" : t.status === "APPROVED" ? "amber" : "green"}>
                      {t.status}
                    </Pill>
                  </div>

                  <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{t.body}</p>

                  {t.status === "OPEN" ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="label">Accept — suspend the institution</p>
                        <ActionForm
                          action={decideSuspensionRecommendation}
                          hidden={{ taskId: t.id, decision: "APPROVED" }}
                          submitLabel="Approve suspension"
                          variant="btn-danger btn-sm"
                          pendingLabel="Recording…"
                          confirm="Approving sets this institution to SUSPENDED. This is recorded against your name. Continue?"
                          className="space-y-2"
                        >
                          <textarea
                            name="note"
                            rows={2}
                            className="textarea min-h-[56px]"
                            placeholder="Reason for suspension (recorded in the audit trail)"
                            required
                          />
                        </ActionForm>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="label">Reject — no suspension</p>
                        <ActionForm
                          action={decideSuspensionRecommendation}
                          hidden={{ taskId: t.id, decision: "REJECTED" }}
                          submitLabel="Reject recommendation"
                          variant="btn-secondary btn-sm"
                          pendingLabel="Recording…"
                          className="space-y-2"
                        >
                          <textarea
                            name="note"
                            rows={2}
                            className="textarea min-h-[56px]"
                            placeholder="Reason the recommendation is not accepted"
                            required
                          />
                        </ActionForm>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-ink-faint">
                      Decided by {t.decidedBy ?? "—"} on {t.decidedAt ? fmtDateTime(t.decidedAt) : "—"}
                      {t.decisionNote ? ` — ${t.decisionNote}` : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Escalations" subtitle="Close one only when the underlying delay has been acted on" />
        </div>

        {visible.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Level</TH>
                <TH>Entity</TH>
                <TH>Reason</TH>
                <TH>Escalated to</TH>
                <TH>Raised</TH>
                <TH>Status</TH>
                <TH>Action</TH>
              </TR>
            </THead>
            <tbody>
              {visible.map((e) => {
                const label =
                  e.entityType === "APPLICATION"
                    ? apps.find((a) => a.id === e.entityId)?.refNumber
                    : e.entityType === "EVC"
                      ? evcs.find((v) => v.id === e.entityId)?.application.refNumber
                      : e.entityType === "UNDERTAKING"
                        ? unds.find((u) => u.id === e.entityId)?.title
                        : docs.find((d) => d.id === e.entityId)?.type.replace(/_/g, " ");

                const href =
                  e.entityType === "APPLICATION"
                    ? `/applications/${e.entityId}`
                    : e.entityType === "EVC"
                      ? `/evc/${e.entityId}`
                      : e.entityType === "UNDERTAKING"
                        ? `/undertakings`
                        : `/documents`;

                return (
                  <TR key={e.id}>
                    <TD>
                      <Pill tone={e.level >= 2 ? "red" : "amber"}>L{e.level}</Pill>
                    </TD>
                    <TD>
                      <Link href={href} className="link text-xs">
                        {e.entityType}
                      </Link>
                      <p className="max-w-[220px] truncate text-[11px] text-ink-faint">{label ?? e.entityId.slice(0, 8)}</p>
                    </TD>
                    <TD className="max-w-[360px] text-xs text-ink-soft">{e.reason}</TD>
                    <TD className="text-xs">{e.toRole.replace(/_/g, " ")}</TD>
                    <TD className="text-xs">{fmtDateTime(e.createdAt)}</TD>
                    <TD>
                      <Pill tone={e.status === "OPEN" ? "red" : "green"}>{e.status}</Pill>
                      {e.resolvedBy ? <p className="mt-1 text-[10px] text-ink-faint">by {e.resolvedBy}</p> : null}
                    </TD>
                    <TD>
                      {e.status === "OPEN" ? (
                        <details>
                          <summary className="cursor-pointer text-xs font-semibold text-indigo-600 hover:underline">
                            Resolve
                          </summary>
                          <div className="mt-2 w-64 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <ActionForm
                              action={resolveEscalationAction}
                              hidden={{ escalationId: e.id }}
                              submitLabel="Mark resolved"
                              variant="btn-success btn-sm"
                              pendingLabel="Saving…"
                            >
                              <textarea name="note" className="textarea min-h-[64px]" placeholder="What action did you take?" />
                            </ActionForm>
                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-ink-faint">{e.resolvedAt ? fmtDateTime(e.resolvedAt) : "—"}</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={<ShieldCheck className="h-7 w-7" />}
              title="No escalations"
              hint="When a case crosses its SLA, the engine raises one here automatically."
            />
          </div>
        )}
      </Card>
    </div>
  );
}
