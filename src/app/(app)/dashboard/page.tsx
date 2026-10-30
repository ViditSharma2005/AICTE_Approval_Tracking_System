import { requireUser } from "@/lib/session";
import { getScopedData } from "@/lib/queries";
import { db } from "@/lib/db";
import { verifyAuditChain } from "@/lib/audit";
import { ROLE_LABELS } from "@/lib/constants";
import { DEMO_MODE, DEMO_DAY_MS } from "@/lib/time";
import { PageHeader } from "@/components/app-shell";
import { Banner } from "@/components/ui";
import {
  AdminDashboard,
  BureauDashboard,
  ComplianceDashboard,
  DASHBOARD_BY_ROLE,
  EvcDashboard,
  InstitutionDashboard,
  OfficerDashboard,
  PolicyDashboard,
  RegionalDashboard,
} from "@/components/dashboards";
import { AutoRefresh } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getScopedData(user);

  const [userRecord, region, institution] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { region: { select: { name: true } }, institution: { select: { name: true, city: true } } } }),
    user.regionId ? db.region.findUnique({ where: { id: user.regionId } }) : null,
    user.institutionId ? db.institution.findUnique({ where: { id: user.institutionId } }) : null,
  ]);

  const scopeLabel = institution?.name ?? region?.name ?? "All India";

  return (
    <div>
      <PageHeader
        title={`${DASHBOARD_BY_ROLE[user.role] ?? "Dashboard"}`}
        subtitle={`${ROLE_LABELS[user.role] ?? user.role} · ${user.name} · ${scopeLabel}`}
        actions={
          DEMO_MODE ? (
            <span className="chip">Demo mode: 1 day = {Math.round(DEMO_DAY_MS / 1000)}s</span>
          ) : (
            <span className="chip">Deadline engine active</span>
          )
        }
      />

      {DEMO_MODE ? (
        <div className="mb-5">
          <Banner tone="amber" title="Time compression is ON">
            One working day lasts {Math.round(DEMO_DAY_MS / 1000)} seconds. Watch SLAs expire, reminders fire and
            escalations climb in real time. Set <span className="font-mono">DEMO_MODE=false</span> in{" "}
            <span className="font-mono">.env</span> for real-world timings.
          </Banner>
        </div>
      ) : null}

      {DEMO_MODE ? <AutoRefresh intervalMs={8000} /> : null}

      <DashboardBody user={user} data={data} />
    </div>
  );
}

async function DashboardBody({
  user,
  data,
}: {
  user: Awaited<ReturnType<typeof requireUser>>;
  data: Awaited<ReturnType<typeof getScopedData>>;
}) {
  switch (user.role) {
    case "INSTITUTION":
      return <InstitutionDashboard user={user} data={data} />;
    case "EVC_COORDINATOR":
    case "EVC_MEMBER":
      return <EvcDashboard user={user} data={data} />;
    case "COMPLIANCE_OFFICER":
      return <ComplianceDashboard user={user} data={data} />;
    case "REGIONAL_OFFICER":
      return <RegionalDashboard user={user} data={data} />;
    case "BUREAU_OFFICER":
      return <BureauDashboard user={user} data={data} />;
    case "POLICY_ADMIN": {
      const rules = await db.routeTemplate.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
      return <PolicyDashboard user={user} data={data} rules={rules} />;
    }
    case "SYSTEM_ADMIN": {
      const [chain, userCount] = await Promise.all([verifyAuditChain(), db.user.count()]);
      return <AdminDashboard user={user} data={data} chain={chain} userCount={userCount} />;
    }
    default:
      return <OfficerDashboard user={user} data={data} />;
  }
}
