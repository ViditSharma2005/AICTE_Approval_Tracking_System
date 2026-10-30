import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader, KeyValue, Pill } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { submitApplication } from "@/app/actions/application";
import { APP_TYPES } from "@/lib/constants";
import { templateSlas, templateStages } from "@/lib/workflow";
import { shortStage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SubmitPage() {
  const user = await requireUser();
  if (user.role !== "INSTITUTION") redirect("/dashboard");
  if (!user.institutionId) {
    return (
      <div>
        <PageHeader title="Submit application" />
        <Banner tone="red" title="Account not linked">
          Your account is not linked to an institution. Ask the system administrator to link it.
        </Banner>
      </div>
    );
  }

  const [institution, templates] = await Promise.all([
    db.institution.findUnique({ where: { id: user.institutionId }, include: { region: true } }),
    db.routeTemplate.findMany({ where: { status: "PUBLISHED" }, orderBy: { key: "asc" } }),
  ]);

  if (!institution) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Submit a new application"
        subtitle={`${institution.name} · ${institution.city}, ${institution.state} · ${institution.region.name} Region`}
      />

      <Card className="mb-5">
        <CardHeader title="Institution particulars" subtitle="Pulled from the institution master record" />
        <KeyValue
          items={[
            { label: "Institution", value: institution.name },
            { label: "AISHE code", value: institution.aisheCode, mono: true },
            { label: "Type", value: institution.type },
            { label: "Region", value: institution.region.name },
            { label: "City / State", value: `${institution.city}, ${institution.state}` },
          ]}
        />
      </Card>

      <Card className="mb-5">
        <CardHeader title="Application details" subtitle="The approval route is selected automatically from the published rules" />
        <ActionForm action={submitApplication} submitLabel="Submit application" pendingLabel="Submitting…" className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="label">Application type</label>
            <select name="type" className="select" required defaultValue="NEW_INSTITUTION">
              {Object.entries(APP_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Programme / course name</label>
            <input name="programName" className="input" placeholder="e.g. B.Tech Computer Science & Engineering" required />
          </div>
          <div>
            <label className="label">Requested intake</label>
            <input name="intake" type="number" min="0" className="input" defaultValue="60" />
          </div>
          <p className="sm:col-span-3 hint">
            On submission the system snapshots the route and SLA that apply today. If the Approval Process Handbook
            changes tomorrow, your case continues under the rules it was filed under.
          </p>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Routes currently in force" subtitle="Published rule versions and their stage-wise SLAs" />
        <div className="space-y-3">
          {templates.map((t) => {
            const stages = templateStages(t);
            const slas = templateSlas(t);
            return (
              <div key={t.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{t.name}</p>
                  <Pill tone="green">v{t.version} published</Pill>
                  <span className="font-mono text-[10px] text-ink-faint">{t.key}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {stages.map((s) => (
                    <span key={s} className="chip">
                      {shortStage(s)} · {slas[s]}d
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {!templates.length ? (
            <Banner tone="amber" title="No published routes">
              A policy administrator must publish at least one route before applications can be filed.
            </Banner>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
