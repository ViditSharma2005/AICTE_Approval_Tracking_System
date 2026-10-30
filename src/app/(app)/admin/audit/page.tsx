import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader, Pill, TD, TH, THead, TR, Table } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!["SYSTEM_ADMIN", "POLICY_ADMIN", "COMPLIANCE_OFFICER"].includes(user.role)) redirect("/dashboard");

  const sp = await searchParams;
  const entity = typeof sp.entity === "string" ? sp.entity : "";

  const [chain, logs, ruleChanges] = await Promise.all([
    verifyAuditChain(),
    db.auditLog.findMany({
      where: entity ? { entityType: entity } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.auditLog.findMany({
      where: { action: { in: ["RULE_PUBLISHED", "RULE_ARCHIVED", "RULE_VERSION_CREATED"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const types = ["Application", "Undertaking", "Document", "EvcVisit", "Escalation", "RouteTemplate", "User"];

  return (
    <div>
      <PageHeader
        title="Audit trail"
        subtitle="Append-only, hash-chained record of every state change in the system"
        actions={
          <>
            <Link href="/admin/audit" className={`btn-sm ${!entity ? "btn-navy" : "btn-secondary"}`}>
              All
            </Link>
            {types.map((t) => (
              <Link key={t} href={`/admin/audit?entity=${t}`} className={`btn-sm ${entity === t ? "btn-navy" : "btn-secondary"}`}>
                {t}
              </Link>
            ))}
          </>
        }
      />

      <div className="mb-5">
        {chain.intact ? (
          <Banner tone="green" title={`Chain verified — ${chain.total} entries intact`}>
            Each entry commits to the hash of the one before it. Editing or deleting any historical row would break the
            chain here.
          </Banner>
        ) : (
          <Banner tone="red" title="TAMPERING DETECTED">
            The chain is broken at entry {chain.brokenAt}. Historical records cannot be trusted.
          </Banner>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr,320px]">
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Entries" subtitle={`Showing the most recent ${logs.length}`} />
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Action</TH>
                <TH>Entity</TH>
                <TH>Actor</TH>
                <TH>Previous hash</TH>
                <TH>Hash</TH>
              </TR>
            </THead>
            <tbody>
              {logs.map((l) => (
                <TR key={l.id}>
                  <TD className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</TD>
                  <TD>
                    <Pill
                      tone={
                        ["REJECT", "ESCALATED", "UNDERTAKING_REJECTED", "DOCUMENT_EXPIRED"].includes(l.action)
                          ? "red"
                          : ["REVERT", "EVC_OVERDUE", "UNDERTAKING_OVERDUE"].includes(l.action)
                            ? "amber"
                            : ["APPROVE", "CONDITIONAL_APPROVE", "UNDERTAKING_VERIFIED", "RULE_PUBLISHED"].includes(l.action)
                              ? "green"
                              : "slate"
                      }
                    >
                      {l.action.replace(/_/g, " ")}
                    </Pill>
                  </TD>
                  <TD className="text-xs">{l.entityType}</TD>
                  <TD className="text-xs font-medium">{l.actorName}</TD>
                  <TD className="font-mono text-[10px] text-ink-faint">{(l.prevHash ?? "GENESIS").slice(0, 10)}…</TD>
                  <TD className="font-mono text-[10px] text-ink-faint">{l.hash.slice(0, 10)}…</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Chain head" />
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">Status</span>
                <Pill tone={chain.intact ? "green" : "red"}>{chain.intact ? "INTACT" : "BROKEN"}</Pill>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">Entries</span>
                <span className="font-mono tnum">{chain.total}</span>
              </div>
              <div className="break-all rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-ink-soft">
                head: {chain.head ?? "—"}
              </div>
            </div>
            <p className="hint mt-3">
              Verification walks every row in order, recomputing each hash from its predecessor. It runs on every load
              of this page.
            </p>
          </Card>

          <Card>
            <CardHeader title="Rule change log" subtitle="Every publish, archive and new version" />
            {ruleChanges.length ? (
              <ul className="space-y-2">
                {ruleChanges.map((r) => (
                  <li key={r.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <p className="flex items-center gap-2 text-xs font-semibold">
                      <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
                      {r.action.replace(/_/g, " ")}
                    </p>
                    <p className="text-[11px] text-ink-soft">
                      {r.actorName} · {fmtDateTime(r.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-faint">No rule changes recorded yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
