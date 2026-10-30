import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader, Pill, TD, TH, THead, TR, Table } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { SubmitButton } from "@/components/client";
import { archiveRule, newVersionRule, publishRule, saveRuleDraft } from "@/app/actions/rules";
import { simulatePublish, templateAppTypes, templateSlas, templateStages, validateTemplate } from "@/lib/workflow";
import { APP_TYPES, STAGES, STAGE_KEYS } from "@/lib/constants";
import { shortStage } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import { AlertTriangle, CheckCircle2, GitBranch } from "lucide-react";

export const dynamic = "force-dynamic";

const SELECTABLE_STAGES = ["SCRUTINY", "EVC", "COMMITTEE", "DECISION"];

export default async function RuleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!["POLICY_ADMIN", "SYSTEM_ADMIN"].includes(user.role)) redirect("/dashboard");

  const { id } = await params;
  const t = await db.routeTemplate.findUnique({ where: { id } });
  if (!t) notFound();

  const stages = templateStages(t);
  const slas = templateSlas(t);
  const appTypes = templateAppTypes(t);
  const instTypes: string[] = JSON.parse(t.institutionTypes || "[]");

  const { errors, warnings } = validateTemplate(t);

  const [published, inflight] = await Promise.all([
    db.routeTemplate.findMany({ where: { status: "PUBLISHED" } }),
    db.application.findMany({
      where: { status: { in: ["IN_PROGRESS", "AWAITING_INSTITUTION"] } },
      select: { id: true, refNumber: true, currentStage: true, routeKey: true, routeSnapshot: true },
    }),
  ]);

  const sim = simulatePublish({ candidate: t, published, inflight });
  const affectedApps = await db.application.findMany({
    where: { routeKey: t.key },
    select: { id: true, refNumber: true, currentStage: true, routeVersion: true, status: true, institution: { select: { name: true } } },
    take: 8,
  });

  const editable = t.status === "DRAFT";
  const canPublish = t.status === "DRAFT" && errors.length === 0 && sim.conflicts.length === 0;

  return (
    <div>
      <PageHeader
        title={`${t.name} · v${t.version}`}
        subtitle={`Route key ${t.key} · ${t.status}`}
        actions={
          <>
            <Link href="/admin/rules" className="btn-secondary btn-sm">
              All routes
            </Link>
            <form action={newVersionRule}>
              <input type="hidden" name="id" value={t.id} />
              <SubmitButton className="btn-secondary btn-sm" pendingLabel="Creating…">
                <GitBranch className="h-3.5 w-3.5" /> New version
              </SubmitButton>
            </form>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr,360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Route definition"
              subtitle={editable ? "Edit and save as draft" : "Published rules are immutable — create a new version to change them"}
            />

            <ActionForm action={saveRuleDraft} hidden={{ id: t.id }} submitLabel="Save draft" pendingLabel="Saving…" className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Route name</label>
                  <input name="name" className="input" defaultValue={t.name} disabled={!editable} required />
                </div>
                <div>
                  <label className="label">Route key (immutable)</label>
                  <input className="input font-mono" defaultValue={t.key} disabled />
                  <input type="hidden" name="key" value={t.key} />
                </div>
              </div>

              <div>
                <label className="label">Stages & stage-wise SLA (days)</label>
                <div className="space-y-2">
                  {SELECTABLE_STAGES.map((s) => {
                    const checked = stages.includes(s as never);
                    return (
                      <div
                        key={s}
                        className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                          <input
                            type="checkbox"
                            name={`stage_${s}`}
                            defaultChecked={checked}
                            disabled={!editable}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                          />
                          <span className="text-sm font-medium text-ink">{shortStage(s)}</span>
                          <span className="hidden truncate text-[11px] text-ink-faint sm:inline">
                            {(STAGES as Record<string, { description: string }>)[s]?.description}
                          </span>
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            name={`sla_${s}`}
                            defaultValue={slas[s] ?? 7}
                            min={1}
                            disabled={!editable}
                            className="input w-20 py-1 text-right"
                          />
                          <span className="text-xs text-ink-faint">days</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="hint">
                  The engine forces DECISION to be the last stage and SCRUTINY to be included, so a case can never be
                  published into a route with no path to disposal.
                </p>
              </div>

              <div>
                <label className="label">Applies to application types</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(APP_TYPES).map(([k, v]) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        name={`type_${k}`}
                        defaultChecked={appTypes.includes(k)}
                        disabled={!editable}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                      {v}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Institution type (leave both unchecked for all)</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {["NEW", "EXISTING"].map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        name={`inst_${k}`}
                        defaultChecked={instTypes.includes(k)}
                        disabled={!editable}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                      {k === "NEW" ? "New institutions" : "Existing institutions"}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Change note (recorded in the audit trail)</label>
                <input name="changeNote" className="input" defaultValue={t.changeNote ?? ""} disabled={!editable} />
              </div>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader title="Applications filed under this route" subtitle="Proof of rule versioning" />
            {affectedApps.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Institution</TH>
                    <TH>Current stage</TH>
                    <TH>Route version</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <tbody>
                  {affectedApps.map((a) => (
                    <TR key={a.id}>
                      <TD>
                        <Link href={`/applications/${a.id}`} className="link font-mono text-xs">
                          {a.refNumber}
                        </Link>
                      </TD>
                      <TD className="max-w-[200px] truncate">{a.institution.name}</TD>
                      <TD>{shortStage(a.currentStage)}</TD>
                      <TD className="font-mono text-xs">v{a.routeVersion ?? 1}</TD>
                      <TD>
                        <Pill tone={a.status === "IN_PROGRESS" ? "blue" : "amber"}>{a.status.replace(/_/g, " ")}</Pill>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-ink-faint">No applications have been filed under this route yet.</p>
            )}
          </Card>
        </div>

        {/* Simulation rail */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Validation" subtitle="Run automatically, always" />
            {errors.length ? (
              <ul className="space-y-1.5">
                {errors.map((e) => (
                  <li key={e} className="flex items-start gap-2 text-xs text-red-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {e}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> No blocking errors. This route always ends in a decision.
              </p>
            )}

            {warnings.length ? (
              <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                {warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Dry-run simulation" subtitle="What happens if you publish this?" />
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">In-flight applications on this route</span>
                <span className="font-mono font-semibold tnum">{sim.affected}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">Would be orphaned (stage removed)</span>
                <span className={`font-mono font-semibold tnum ${sim.orphaned.length ? "text-red-600" : ""}`}>
                  {sim.orphaned.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">Conflicting live routes</span>
                <span className={`font-mono font-semibold tnum ${sim.conflicts.length ? "text-red-600" : ""}`}>
                  {sim.conflicts.length}
                </span>
              </div>
            </div>

            {sim.conflicts.length ? (
              <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                {sim.conflicts.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-xs text-red-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            ) : null}

            <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
              {sim.notes.map((n) => (
                <li key={n} className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-soft">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                  {n}
                </li>
              ))}
            </ul>

            {sim.orphaned.length ? (
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                {sim.orphaned.map((o) => (
                  <li key={o.id} className="text-[11px] text-amber-700">
                    {o.refNumber} sits at {shortStage(o.currentStage)}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Publish" subtitle="Restricted to policy administrators" />
            {t.status === "PUBLISHED" ? (
              <>
                <p className="text-xs text-ink-soft">
                  Published {t.publishedAt ? fmtDateTime(t.publishedAt) : "—"} by {t.publishedBy ?? "—"}.
                </p>
                <form action={archiveRule} className="mt-3">
                  <input type="hidden" name="id" value={t.id} />
                  <SubmitButton className="btn-secondary btn-sm" pendingLabel="Archiving…" confirm="Archive this route? New applications will stop using it.">
                    Archive route
                  </SubmitButton>
                </form>
              </>
            ) : (
              <>
                <ActionForm
                  action={publishRule}
                  hidden={{ id: t.id }}
                  submitLabel="Publish this version"
                  pendingLabel="Publishing…"
                  confirm="Publish this rule version? It takes effect for all new applications immediately."
                >
                  <p className="text-xs text-ink-soft">
                    {canPublish
                      ? "Publishing archives the previous live version of this route. In-flight applications keep their snapshot."
                      : "Fix the errors above before publishing. The publish button is intentionally not gated in the UI only — the server re-validates and refuses."}
                  </p>
                </ActionForm>
                <form action={archiveRule} className="mt-3">
                  <input type="hidden" name="id" value={t.id} />
                  <SubmitButton className="btn-ghost btn-sm" pendingLabel="Archiving…">
                    Discard draft
                  </SubmitButton>
                </form>
              </>
            )}
          </Card>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
            <p className="text-xs leading-relaxed text-indigo-900">
              <span className="font-semibold">Why this screen wins arguments:</span> an administrator can prove, before
              publishing, exactly how many live cases are affected and whether any would be stranded. Rule changes are
              governance acts, not code edits.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
