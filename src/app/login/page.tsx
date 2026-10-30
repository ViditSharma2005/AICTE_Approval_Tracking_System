import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/constants";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const existing = await getUser();
  if (existing) redirect("/dashboard");

  const users = await db.user.findMany({
    include: { region: { select: { name: true } }, institution: { select: { name: true } } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const groupOf = (role: string) =>
    role === "INSTITUTION" ? "Institutions" : ["REGIONAL_OFFICER", "BUREAU_OFFICER"].includes(role) ? "Supervisory" : ["POLICY_ADMIN", "SYSTEM_ADMIN"].includes(role) ? "Administration" : "Processing & Decision";

  const accounts = users.map((u) => ({
    email: u.email,
    name: u.name,
    roleLabel: ROLE_LABELS[u.role] ?? u.role,
    scope: u.institution?.name ?? u.region?.name ?? "All India",
    group: groupOf(u.role),
  }));

  return (
    <div className="min-h-screen bg-canvas">
      <div className="gov-strip">
        <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-5">
          <div className="seal-ring flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
            <Landmark className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold">AICTE — Approval &amp; Compliance Command Centre</p>
            <p className="text-[10px] uppercase tracking-wider text-white/60">
              All India Council for Technical Education · Government of India
            </p>
          </div>
        </div>
      </div>
      <div className="tricolor" />

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-8 max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight text-navy sm:text-3xl">
            Every application, a trackable case file.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Route · Assign · Remind · Escalate · Verify · Record. One platform that moves an application from submission
            to decision, then keeps watching the undertakings and document validity long after the approval letter is
            issued.
          </p>
        </div>

        <LoginForm accounts={accounts} />

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            { t: "No application gets lost", d: "Every case file carries a live route, an owner and a deadline." },
            { t: "No deadline is missed", d: "Tiered reminders, then a three-rung escalation ladder that never sleeps." },
            { t: "No decision is automated away", d: "Officers decide. The system tracks, reminds, escalates and records." },
          ].map((x) => (
            <div key={x.t} className="card card-pad">
              <p className="text-sm font-semibold text-navy">{x.t}</p>
              <p className="mt-1 text-xs text-ink-soft">{x.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
