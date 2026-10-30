import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Card, CardHeader, Pill, TD, TH, THead, TR, Table } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { createUserAction, resetPasswordAction, setWorkloadCap } from "@/app/actions/admin";
import { DEFAULT_PASSWORD, ROLES, ROLE_LABELS } from "@/lib/constants";
import { activeCaseCount } from "@/lib/assignment";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requireUser();
  if (user.role !== "SYSTEM_ADMIN") redirect("/dashboard");

  const [users, regions, institutions, loads] = await Promise.all([
    db.user.findMany({
      include: { region: { select: { name: true } }, institution: { select: { name: true } } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    db.region.findMany({ orderBy: { name: "asc" } }),
    db.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    Promise.all(
      (
        await db.user.findMany({
          where: { role: { in: ["SCRUTINY_OFFICER", "EVC_COORDINATOR", "COMMITTEE_MEMBER", "COMPLIANCE_OFFICER"] } },
          select: { id: true, role: true },
        })
      ).map(async (u) => ({
        id: u.id,
        active: await activeCaseCount(u.id, u.role),
      })),
    ),
  ]);
  const loadById = new Map(loads.map((l) => [l.id, l.active]));

  return (
    <div>
      <PageHeader title="Users & roles" subtitle={`${users.length} accounts · role determines what each person can see and do`} />

      <Card padded={false} className="mb-5">
        <div className="p-5 pb-3">
          <CardHeader title="Accounts" subtitle="Institution users are locked to their own institution; regional staff to their region" />
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Scope</TH>
              <TH>Active / cap</TH>
              <TH>Reset password</TH>
            </TR>
          </THead>
          <tbody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium">{u.name}</TD>
                <TD className="font-mono text-xs">{u.email}</TD>
                <TD>
                  <Pill tone="indigo">{ROLE_LABELS[u.role] ?? u.role}</Pill>
                </TD>
                <TD className="text-xs">{u.institution?.name ?? u.region?.name ?? "All India"}</TD>
                <TD>
                  {loadById.has(u.id) ? (
                    <div className="space-y-2">
                      <p className="text-xs tnum">
                        <span className="font-semibold text-ink">{loadById.get(u.id)}</span>
                        <span className="text-ink-faint"> / {u.maxActiveCases} active</span>
                      </p>
                      <ActionForm
                        action={setWorkloadCap}
                        hidden={{ id: u.id }}
                        submitLabel="Set cap"
                        variant="btn-secondary btn-sm"
                        pendingLabel="Saving…"
                        className="flex items-center gap-2"
                      >
                        <input
                          type="number"
                          name="maxActiveCases"
                          min={1}
                          max={100}
                          defaultValue={u.maxActiveCases}
                          className="input w-20"
                          aria-label={`Workload cap for ${u.name}`}
                        />
                      </ActionForm>
                    </div>
                  ) : (
                    <span className="text-xs text-ink-faint">—</span>
                  )}
                </TD>
                <TD>
                  <ActionForm
                    action={resetPasswordAction}
                    hidden={{ id: u.id }}
                    submitLabel={`Reset to ${DEFAULT_PASSWORD}`}
                    variant="btn-secondary btn-sm"
                    pendingLabel="Resetting…"
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="password" value={DEFAULT_PASSWORD} />
                  </ActionForm>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Create user" subtitle="New accounts get the standard demo password unless you set one" />
        <ActionForm action={createUserAction} submitLabel="Create account" pendingLabel="Creating…" className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Full name</label>
            <input name="name" className="input" required />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" required />
          </div>
          <div>
            <label className="label">Role</label>
            <select name="role" className="select" required>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Region (regional roles)</label>
            <select name="regionId" className="select">
              <option value="">— none —</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Institution (institution role)</label>
            <select name="institutionId" className="select">
              <option value="">— none —</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Password</label>
            <input name="password" className="input" defaultValue={DEFAULT_PASSWORD} />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
