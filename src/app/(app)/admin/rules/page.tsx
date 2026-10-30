import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader, Pill, TD, TH, THead, TR, Table } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { createRuleDraft } from "@/app/actions/rules";
import { templateAppTypes, templateSlas, templateStages } from "@/lib/workflow";
import { shortStage } from "@/lib/queries";
import { fmtDateTime } from "@/lib/time";
import { GitBranch, PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const user = await requireUser();
  if (!["POLICY_ADMIN", "SYSTEM_ADMIN"].includes(user.role)) redirect("/dashboard");

  const templates = await db.routeTemplate.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
  const applications = await db.application.findMany({
    select: { routeKey: true, status: true },
  });

  const byKey = templates.reduce<Record<string, typeof templates>>((acc, t) => {
    (acc[t.key] ||= []).push(t);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Rule engine — Approval Process Handbook"
        subtitle="Configure routes, stage-wise SLAs and applicability as versioned rules instead of hard-coded stages"
      />

      <div className="mb-5">
        <Banner tone="indigo" title="How rule versioning works">
          An application stores a <span className="font-semibold">snapshot</span> of the route and SLAs it was filed
          under. Publishing a new version changes what happens to new applicants only — in-flight cases are never
          re-routed retroactively, because that would be unfair to them.
        </Banner>
      </div>

      <div className="space-y-4">
        {Object.entries(byKey).map(([key, versions]) => {
          const live = versions.find((v) => v.status === "PUBLISHED");
          return (
            <Card key={key} padded={false}>
              <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-indigo-600" />
                    <h3 className="text-sm font-semibold text-ink">{live?.name ?? versions[0].name}</h3>
                    <span className="font-mono text-[11px] text-ink-faint">{key}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    {versions.length} version(s) · {applications.filter((a) => a.routeKey === key).length} application(s)
                    filed under this route
                  </p>
                </div>
                {live ? (
                  <Pill tone="green">Live: v{live.version}</Pill>
                ) : (
                  <Pill tone="amber">No published version</Pill>
                )}
              </div>

              <Table>
                <THead>
                  <TR>
                    <TH>Version</TH>
                    <TH>Status</TH>
                    <TH>Stages & SLAs</TH>
                    <TH>Applies to</TH>
                    <TH>Published</TH>
                    <TH>Note</TH>
                    <TH />
                  </TR>
                </THead>
                <tbody>
                  {versions.map((t) => {
                    const stages = templateStages(t);
                    const slas = templateSlas(t);
                    return (
                      <TR key={t.id}>
                        <TD className="font-mono text-xs">v{t.version}</TD>
                        <TD>
                          <Pill tone={t.status === "PUBLISHED" ? "green" : t.status === "DRAFT" ? "amber" : "slate"}>
                            {t.status}
                          </Pill>
                        </TD>
                        <TD>
                          <div className="flex flex-wrap gap-1">
                            {stages.map((s) => (
                              <span key={s} className="chip">
                                {shortStage(s)} · {slas[s]}d
                              </span>
                            ))}
                          </div>
                        </TD>
                        <TD className="text-xs">
                          {templateAppTypes(t)
                            .map((x) => x.replace(/_/g, " "))
                            .join(", ") || "—"}
                        </TD>
                        <TD className="text-xs">{t.publishedAt ? fmtDateTime(t.publishedAt) : "—"}</TD>
                        <TD className="max-w-[220px] truncate text-xs text-ink-faint">{t.changeNote ?? "—"}</TD>
                        <TD>
                          <Link href={`/admin/rules/${t.id}`} className="link text-xs">
                            Open
                          </Link>
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          );
        })}
      </div>

      <Card className="mt-5">
        <CardHeader title="Create a new route" subtitle="Every route is versioned from the moment it is created" />
        <ActionForm
          action={createRuleDraft}
          submitLabel="Create draft"
          pendingLabel="Creating…"
          className="grid gap-4 sm:grid-cols-3"
        >
          <div>
            <label className="label">Route key</label>
            <input name="key" className="input font-mono" placeholder="ROUTE_NEW_INSTITUTION" required />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Display name</label>
            <input name="name" className="input" placeholder="New Institution — full route" required />
          </div>
        </ActionForm>
        <p className="hint mt-3">
          <PlusCircle className="mr-1 inline h-3 w-3" />
          To change a live route, open it and use “New version” — drafts are validated and simulated before they can be
          published.
        </p>
      </Card>
    </div>
  );
}
