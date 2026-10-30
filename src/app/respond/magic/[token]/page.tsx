import Link from "next/link";
import { db } from "@/lib/db";
import { magicLinkState } from "@/lib/magic";
import { fmtDateTime, daysUntil } from "@/lib/time";
import { UndertakingStatusPill } from "@/components/case";
import { ActionForm } from "@/components/forms";
import { respondViaMagicLink } from "@/app/actions/undertaking";
import { FileCheck2, Link2Off, ShieldCheck, Clock3 } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Feature 6 — public, unauthenticated, mobile-first response page.
 * One card, one task, one action. Nothing else is reachable from here.
 */
export default async function MagicRespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await magicLinkState(token);

  if (state !== "OK") {
    return (
      <Shell>
        <div className="card card-pad text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <Link2Off className="h-6 w-6 text-slate-500" />
          </div>
          <h1 className="text-lg font-bold text-navy">
            {state === "USED" ? "This link has already been used" : state === "EXPIRED" ? "This link has expired" : "This link is not valid"}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
            {state === "USED"
              ? "Your response was recorded. If you need to send anything else, sign in to the portal."
              : "Response links are valid for 72 hours and can be used once. Please sign in to the portal to complete this task."}
          </p>
          <Link href="/login" className="btn-primary btn-sm mt-5">
            Go to portal sign in
          </Link>
        </div>
      </Shell>
    );
  }

  const link = await db.magicLink.findUnique({ where: { token } });
  const undertaking = link
    ? await db.undertaking.findUnique({
        where: { id: link.entityId },
        include: {
          institution: { select: { name: true, city: true, state: true } },
          application: { select: { refNumber: true } },
          submissions: { orderBy: { submittedAt: "desc" }, take: 1 },
        },
      })
    : null;

  if (!link || !undertaking) {
    return (
      <Shell>
        <div className="card card-pad text-center">
          <h1 className="text-lg font-bold text-navy">This link is not valid</h1>
          <p className="mt-2 text-sm text-ink-soft">The compliance item it points to no longer exists.</p>
          <Link href="/login" className="btn-primary btn-sm mt-5">
            Go to portal sign in
          </Link>
        </div>
      </Shell>
    );
  }

  const daysLeft = daysUntil(undertaking.dueAt);
  const overdue = daysLeft < 0;

  return (
    <Shell>
      <div className="card card-pad">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {undertaking.phase === "PRE" ? "Deficiency to remedy" : "Condition of approval"}
            </p>
            <h1 className="mt-0.5 text-lg font-bold leading-snug text-navy">{undertaking.title}</h1>
            {undertaking.application ? (
              <p className="mt-0.5 font-mono text-xs text-ink-faint">{undertaking.application.refNumber}</p>
            ) : null}
          </div>
          <UndertakingStatusPill status={undertaking.status} />
        </div>

        <p className="mt-4 text-sm leading-relaxed text-ink-soft">{undertaking.description}</p>

        <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-faint">Institution</dt>
            <dd className="text-right font-medium text-ink">
              {undertaking.institution.name}
              <span className="block text-[11px] font-normal text-ink-faint">
                {undertaking.institution.city}, {undertaking.institution.state}
              </span>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-faint">Due by</dt>
            <dd className={`text-right font-medium tnum ${overdue ? "text-red-700" : "text-ink"}`}>
              {fmtDateTime(undertaking.dueAt)}
              <span className="block text-[11px] font-normal">
                {overdue ? `${Math.abs(daysLeft)} day(s) overdue` : `${daysLeft} day(s) left`}
              </span>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-faint">Link valid until</dt>
            <dd className="text-right font-medium text-ink tnum">
              {fmtDateTime(link.expiresAt)}
              <span className="block text-[11px] font-normal text-ink-faint">single use · 72 hours</span>
            </dd>
          </div>
        </dl>

        {undertaking.status === "SUBMITTED" ? (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            A response has been recorded for this item and is awaiting verification by the compliance officer.
          </p>
        ) : (
          <div className="mt-5">
            <p className="label">Upload proof of compliance</p>
            <ActionForm
              action={respondViaMagicLink}
              hidden={{ token }}
              submitLabel="Submit response"
              pendingLabel="Submitting…"
              className="space-y-3"
            >
              <input name="fileName" className="input" placeholder="fire-noc-2026.pdf" required />
              <textarea name="note" className="textarea min-h-[80px]" placeholder="Anything the officer should know (optional)" />
            </ActionForm>
          </div>
        )}

        <p className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-ink-faint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This page works without signing in because it was opened from a single-use link sent to your institution. It can
          only be used for the item above, and your submission is recorded in the audit trail as &ldquo;Institution (magic
          link)&rdquo;.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-5">
          <div className="h-[3px] w-full rounded-full bg-[linear-gradient(90deg,#FF9933_0%,#FF9933_33%,#FFFFFF_33%,#FFFFFF_66%,#138808_66%,#138808_100%)]" />
          <div className="mt-3 flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-navy" />
            <div>
              <p className="text-sm font-bold leading-tight text-navy">AICTE Approval &amp; Compliance Portal</p>
              <p className="text-[11px] text-ink-faint">Compliance response — no sign-in required</p>
            </div>
          </div>
        </div>
        {children}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
          <Clock3 className="h-3 w-3" /> Links expire 72 hours after they are issued.
        </p>
      </div>
    </main>
  );
}
