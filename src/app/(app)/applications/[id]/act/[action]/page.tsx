import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getCaseFile, shortStage } from "@/lib/queries";
import { availableActions, effectiveStage, type Action } from "@/lib/workflow";
import { PageHeader } from "@/components/app-shell";
import { Banner, Card, CardHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { UndertakingRows } from "@/components/client";
import { performTransition } from "@/app/actions/application";
import { StatusPill, StageStepper } from "@/components/case";
import { parseStringArray } from "@/lib/json";

export const dynamic = "force-dynamic";

export default async function ActPage({
  params,
}: {
  params: Promise<{ id: string; action: string }>;
}) {
  const user = await requireUser();
  const { id, action } = await params;

  const app = await getCaseFile(id);
  if (!app) notFound();

  const allowed = availableActions({ role: user.role, stage: app.currentStage, evcStatus: app.evcVisit?.status });
  if (!allowed.includes(action as Action)) {
    return (
      <div>
        <PageHeader title="Action not permitted" />
        <Banner tone="red" title={`Your role cannot perform "${action}" on this case right now.`}>
          This case sits at {shortStage(app.currentStage)}, which is owned by another role. Statutory decisions are
          never transferred — this is the human-in-the-loop safeguard.
        </Banner>
        <Link href={`/applications/${app.id}`} className="btn-secondary btn-sm mt-4">
          Back to case file
        </Link>
      </div>
    );
  }

  const reasonsRequired = ["REVERT", "REJECT"].includes(action);
  const route = parseStringArray(app.routeSnapshot);
  const nextStage = route[route.indexOf(effectiveStage(app.currentStage as never)) + 1];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={titleFor(action)}
        subtitle={`${app.refNumber} · ${app.institution.name} · currently at ${shortStage(app.currentStage)}`}
        actions={
          <Link href={`/applications/${app.id}`} className="btn-secondary btn-sm">
            Cancel
          </Link>
        }
      />

      <Card className="mb-5">
        <CardHeader title="Where this case goes" />
        <StageStepper route={route} currentStage={app.currentStage} status={app.status} compact />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusPill status={app.status} />
          {action === "APPROVE_STAGE" ? (
            <p className="text-sm text-ink-soft">
              On confirmation the case moves to <span className="font-semibold text-ink">{shortStage(nextStage ?? "—")}</span>,
              the SLA clock restarts and the owning role is notified automatically.
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <ActionForm
          action={performTransition}
          hidden={{ applicationId: app.id, action }}
          submitLabel={submitLabelFor(action)}
          confirm={["APPROVE", "REJECT", "CONDITIONAL_APPROVE"].includes(action) ? "Record this decision? It is final and audited." : undefined}
          pendingLabel="Recording…"
        >
          {action === "REVERT" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
                <div>
                  <label className="label">Deficiency title</label>
                  <input
                    name="deficiencyTitle"
                    className="input"
                    placeholder="e.g. Submit renewed lease deed"
                    required
                  />
                </div>
                <div>
                  <label className="label">Time allowed to respond</label>
                  <select name="deficiencyDays" className="select" defaultValue="15">
                    {[7, 10, 15, 21, 30].map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="hint">
                The deficiency becomes a tracked task with its own deadline, reminders at 7 / 2 / 0 days and an
                escalation ladder. It is not an informal "revert".
              </p>
            </>
          ) : null}

          {action === "CONDITIONAL_APPROVE" ? <UndertakingRows /> : null}

          <div>
            <label className="label">
              {action === "REVERT"
                ? "Deficiency details (what the institution must fix)"
                : action === "REJECT"
                  ? "Grounds for rejection (recorded on the case file)"
                  : action === "RESUBMIT"
                    ? "Note for the officer"
                    : "Remarks (optional, recorded on the case file)"}
            </label>
            <textarea
              name="reason"
              className="textarea"
              required={reasonsRequired}
              placeholder={
                action === "REVERT"
                  ? "Describe precisely what is missing or non-compliant."
                  : action === "REJECT"
                    ? "Cite the provision of the Approval Process Handbook that is not met."
                    : "Add context for the record."
              }
            />
            {reasonsRequired ? (
              <p className="hint">A recorded reason is mandatory for this action — the system will refuse to proceed without one.</p>
            ) : null}
          </div>

          {action === "REJECT" || action === "APPROVE" || action === "CONDITIONAL_APPROVE" ? (
            <Banner tone={action === "APPROVE" ? "green" : action === "REJECT" ? "red" : "amber"} title="Statutory act">
              This decision is attributed to <span className="font-semibold">{user.name}</span> and written to the
              append-only audit trail. The platform does not make decisions — it records them.
            </Banner>
          ) : null}
        </ActionForm>
      </Card>
    </div>
  );
}

function titleFor(action: string) {
  const map: Record<string, string> = {
    APPROVE_STAGE: "Complete stage & forward",
    REVERT: "Raise deficiency",
    RESUBMIT: "Submit reply to AICTE",
    APPROVE: "Approve application",
    CONDITIONAL_APPROVE: "Conditionally approve",
    REJECT: "Reject application",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

function submitLabelFor(action: string) {
  const map: Record<string, string> = {
    APPROVE_STAGE: "Forward case",
    REVERT: "Raise deficiency & revert",
    RESUBMIT: "Submit reply",
    APPROVE: "Record approval",
    CONDITIONAL_APPROVE: "Record conditional approval",
    REJECT: "Record rejection",
  };
  return map[action] ?? "Submit";
}
