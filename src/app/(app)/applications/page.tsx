import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getApplications } from "@/lib/queries";
import { db } from "@/lib/db";
import { APP_TYPES, STAGES } from "@/lib/constants";
import { PageHeader } from "@/components/app-shell";
import { Card, CardHeader, EmptyState, Pill, TD, TH, THead, TR, Table } from "@/components/ui";
import { PriorityBadge, SlaChip, StatusPill } from "@/components/case";
import { shortStage } from "@/lib/queries";
import { FilePlus2, FolderOpen, Search } from "lucide-react";
import { daysSince } from "@/lib/time";
import { TrustBadge } from "@/components/trust-badge";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const filters = {
    q: one("q") || undefined,
    stage: one("stage") || undefined,
    status: one("status") || undefined,
    regionId: one("region") || undefined,
    type: one("type") || undefined,
    overdue: one("overdue") === "1" || undefined,
    mine: one("mine") === "1" || undefined,
  };

  const { rows, total, open, overdue } = await getApplications(user, filters);
  const regions = await db.region.findMany({ orderBy: { name: "asc" } });

  return (
    <div>
      <PageHeader
        title="Applications"
        subtitle={`${total} case file(s) in view · ${open} live · ${overdue} past SLA`}
        actions={
          user.role === "INSTITUTION" ? (
            <Link href="/institution/submit" className="btn-primary btn-sm">
              <FilePlus2 className="h-4 w-4" /> New application
            </Link>
          ) : (
            <>
              <Link href={`/applications?overdue=1`} className="btn-secondary btn-sm">
                Only past SLA
              </Link>
              {user.role === "SCRUTINY_OFFICER" ? (
                <Link href={`/applications?mine=1`} className="btn-secondary btn-sm">
                  Assigned to me
                </Link>
              ) : null}
            </>
          )
        }
      />

      <Card className="mb-5">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" method="GET">
          <div className="lg:col-span-2">
            <label className="label">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input name="q" defaultValue={filters.q ?? ""} className="input pl-9" placeholder="Reference, institution or programme" />
            </div>
          </div>

          <div>
            <label className="label">Stage</label>
            <select name="stage" defaultValue={filters.stage ?? ""} className="select">
              <option value="">All stages</option>
              {Object.keys(STAGES)
                .filter((s) => s !== "COMPLETED")
                .map((s) => (
                  <option key={s} value={s}>
                    {shortStage(s)}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="label">Status</label>
            <select name="status" defaultValue={filters.status ?? ""} className="select">
              <option value="">All statuses</option>
              {["IN_PROGRESS", "AWAITING_INSTITUTION", "APPROVED", "CONDITIONALLY_APPROVED", "REJECTED"].map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Type</label>
            <select name="type" defaultValue={filters.type ?? ""} className="select">
              <option value="">All types</option>
              {Object.keys(APP_TYPES).map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button type="submit" className="btn-primary btn-sm flex-1">
              Apply
            </button>
            <Link href="/applications" className="btn-secondary btn-sm">
              Reset
            </Link>
          </div>

          {regions.length > 1 && user.role !== "INSTITUTION" ? (
            <div className="lg:col-span-6">
              <label className="label">Region</label>
              <select name="region" defaultValue={filters.regionId ?? ""} className="select">
                <option value="">All regions</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </form>
      </Card>

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Case files"
            subtitle="Sorted by urgency — overdue cases and higher escalation levels rise to the top"
          />
        </div>
        {rows.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Reference</TH>
                <TH>Institution</TH>
                <TH>Type</TH>
                <TH>Stage</TH>
                <TH>Status</TH>
                <TH>SLA</TH>
                <TH>Age</TH>
                <TH>Priority</TH>
              </TR>
            </THead>
            <tbody>
              {rows.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/applications/${a.id}`} className="link font-mono text-xs">
                      {a.refNumber}
                    </Link>
                    <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-ink-faint">
                      {a.programName || "—"}
                    </p>
                  </TD>
                  <TD className="max-w-[200px]">
                    <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                      <span className="truncate">{a.institution.name}</span>
                      <TrustBadge institutionId={a.institution.id} score={a.institution.trustScore} name={a.institution.name} />
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      {a.region.name} · {a.institution.city}
                    </p>
                  </TD>
                  <TD className="text-xs">{a.type.replace(/_/g, " ")}</TD>
                  <TD>
                    <span className="text-xs font-medium">{shortStage(a.currentStage)}</span>
                    {a.assignedTo ? (
                      <p className="text-[11px] text-ink-faint">→ {a.assignedTo.name}</p>
                    ) : null}
                  </TD>
                  <TD>
                    <StatusPill status={a.status} />
                    {a.escalationLevel > 0 ? (
                      <p className="mt-1">
                        <Pill tone="red">L{a.escalationLevel} escalated</Pill>
                      </p>
                    ) : null}
                  </TD>
                  <TD>
                    <SlaChip dueAt={a.dueAt} />
                  </TD>
                  <TD className="tnum text-xs">{daysSince(a.submittedAt)}d</TD>
                  <TD>
                    <PriorityBadge score={a.priority.score} band={a.priority.band} reasons={a.priority.reasons} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={<FolderOpen className="h-7 w-7" />}
              title="No applications match these filters"
              hint="Clear the filters, or submit a new application if you are an institution user."
            />
          </div>
        )}
      </Card>
    </div>
  );
}
