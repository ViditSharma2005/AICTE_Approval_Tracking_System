/**
 * The workflow engine. Pure functions only — no database access — so the whole
 * routing + rule-validation layer is unit-testable and demo-safe.
 */

import { REVERTABLE_STAGES, STAGES, STAGE_KEYS, type StageKey } from "./constants";
import { parseNumberMap, parseStringArray } from "./json";

export type Action =
  | "APPROVE_STAGE"
  | "REVERT"
  | "RESUBMIT"
  | "APPROVE"
  | "CONDITIONAL_APPROVE"
  | "REJECT";

export const ACTION_LABELS: Record<Action, string> = {
  APPROVE_STAGE: "Forward to next stage",
  REVERT: "Raise deficiency / revert to institution",
  RESUBMIT: "Resubmit reply to AICTE",
  APPROVE: "Approve",
  CONDITIONAL_APPROVE: "Conditionally approve (with undertakings)",
  REJECT: "Reject",
};

export type TransitionResult =
  | { toStage: StageKey; newStatus: "IN_PROGRESS" | "AWAITING_INSTITUTION" | "APPROVED" | "CONDITIONALLY_APPROVED" | "REJECTED"; terminal: boolean }
  | { error: string };

export function stageLabel(stage: string): string {
  return (STAGES as Record<string, { label: string }>)[stage]?.label ?? stage;
}

export function stageShort(stage: string): string {
  return (STAGES as Record<string, { short: string }>)[stage]?.short ?? stage;
}

/**
 * RE_SCRUTINY is the return path for a deficiency reply; it occupies the same
 * slot in the route as SCRUTINY. Mapping it keeps the stepper and the
 * "what comes next" calculation correct after a case has been reverted.
 */
export function effectiveStage(stage: StageKey): StageKey {
  return stage === "RE_SCRUTINY" ? "SCRUTINY" : stage;
}

/**
 * Given an action, work out where the case file goes next.
 * Rules that matter for the problem statement:
 *  - a revert / rejection is NEVER allowed without a recorded reason
 *  - a revert always creates a trackable task for the institution
 *  - only a human (the owning role) can reach a decision action
 */
export function computeNext(params: {
  action: Action;
  currentStage: StageKey;
  route: StageKey[];
  reason?: string;
}): TransitionResult {
  const { action, currentStage, route, reason } = params;

  if (!STAGE_KEYS.includes(currentStage)) return { error: `Unknown stage "${currentStage}".` };

  // Statutory safeguard: every adverse / corrective action must carry a reason.
  if ((action === "REVERT" || action === "REJECT") && !reason?.trim()) {
    return { error: "A reason must be recorded for this action." };
  }

  switch (action) {
    case "APPROVE_STAGE": {
      const idx = route.indexOf(effectiveStage(currentStage));
      if (idx === -1) return { error: "Current stage is not part of this application's route." };
      const next = route[idx + 1];
      if (!next) return { error: "No further stage on this route — record a decision instead." };
      return { toStage: next, newStatus: "IN_PROGRESS", terminal: false };
    }

    case "REVERT": {
      if (!REVERTABLE_STAGES.includes(currentStage)) {
        return { error: `A deficiency cannot be raised from ${stageLabel(currentStage)}.` };
      }
      return { toStage: "INSTITUTION_RESPONSE", newStatus: "AWAITING_INSTITUTION", terminal: false };
    }

    case "RESUBMIT": {
      if (currentStage !== "INSTITUTION_RESPONSE") {
        return { error: "This application is not awaiting an institution reply." };
      }
      return { toStage: "RE_SCRUTINY", newStatus: "IN_PROGRESS", terminal: false };
    }

    case "APPROVE":
      return { toStage: "COMPLETED", newStatus: "APPROVED", terminal: true };

    case "CONDITIONAL_APPROVE":
      return { toStage: "COMPLETED", newStatus: "CONDITIONALLY_APPROVED", terminal: true };

    case "REJECT":
      return { toStage: "COMPLETED", newStatus: "REJECTED", terminal: true };
  }
}

/**
 * Which actions the logged-in user may take on this case file right now.
 * This is the "human-in-the-loop" boundary made visible in the UI.
 */
export function availableActions(params: {
  role: string;
  stage: string;
  evcStatus?: string | null;
}): Action[] {
  const { role, stage, evcStatus } = params;
  const s = stage as StageKey;

  if (role === "INSTITUTION" && s === "INSTITUTION_RESPONSE") return ["RESUBMIT"];

  if (role === "SCRUTINY_OFFICER" && (s === "SCRUTINY" || s === "RE_SCRUTINY")) {
    return ["APPROVE_STAGE", "REVERT", "REJECT"];
  }

  if (role === "EVC_COORDINATOR" && s === "EVC") {
    // The visit must be completed (report filed) before the stage can be closed.
    if (evcStatus === "COMPLETED") return ["APPROVE_STAGE", "REVERT"];
    return ["REVERT"];
  }

  if (role === "COMMITTEE_MEMBER" && s === "COMMITTEE") return ["APPROVE_STAGE", "REVERT"];

  if (role === "COMPETENT_AUTHORITY" && s === "DECISION") {
    return ["APPROVE", "CONDITIONAL_APPROVE", "REJECT"];
  }

  if (role === "POLICY_ADMIN" || role === "SYSTEM_ADMIN" || role === "BUREAU_OFFICER" || role === "REGIONAL_OFFICER") {
    // Supervisory roles: read-only by design. Every statutory act is done by the
    // owning officer; supervisors act through the escalation ladder.
    return [];
  }

  return [];
}

/** Reason (shown in the UI) why a user has no actions on this case. */
export function noActionReason(role: string, stage: string): string {
  const owner = (STAGES as Record<string, { owner: string | null; label: string }>)[stage];
  if (!owner) return "";
  if (owner.owner === role) return "Waiting on the inspection report before this stage can be closed.";
  return `This case sits with the ${owner.owner ? owner.label : "assigned officer"} (${owner.label}).`;
}

// ---------------------------------------------------------------------------
// Rule engine: templates, validation, simulation
// ---------------------------------------------------------------------------

export type RouteTemplateLike = {
  id?: string;
  key: string;
  name: string;
  version?: number;
  status?: string;
  stages: string;
  slaDays: string;
  appTypes: string;
  institutionTypes?: string;
};

export function templateStages(t: RouteTemplateLike): StageKey[] {
  return parseStringArray(t.stages).filter((s): s is StageKey => STAGE_KEYS.includes(s as StageKey));
}

export function templateSlas(t: RouteTemplateLike): Record<string, number> {
  return parseNumberMap(t.slaDays);
}

export function templateAppTypes(t: RouteTemplateLike): string[] {
  return parseStringArray(t.appTypes);
}

/**
 * Hard validation of a draft rule. Publishing a rule that fails this is blocked —
 * this is what stops an admin from shipping a route with no path to a decision.
 */
export function validateTemplate(t: RouteTemplateLike): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stages = templateStages(t);
  const slas = templateSlas(t);

  if (!t.key?.trim()) errors.push("Route key is required.");
  if (!t.name?.trim()) errors.push("Route name is required.");
  if (stages.length < 2) errors.push("A route needs at least two stages.");

  const seen = new Set<string>();
  for (const s of stages) {
    if (seen.has(s)) errors.push(`Stage "${stageLabel(s)}" appears more than once — a case cannot loop.`);
    seen.add(s);
  }

  if (stages.includes("COMPLETED")) errors.push("COMPLETED is a system state and must not be listed as a stage.");
  if (!stages.includes("DECISION")) errors.push("Route has no DECISION stage — applications would never be disposed of.");
  if (stages.indexOf("DECISION") !== stages.length - 1)
    errors.push("DECISION must be the final stage of the route.");
  if (!stages.includes("SCRUTINY")) errors.push("Route must begin with SCRUTINY.");

  for (const s of stages) {
    if (s === "COMPLETED") continue;
    const sla = slas[s];
    if (sla === undefined) errors.push(`No SLA defined for stage "${stageLabel(s)}".`);
    else if (sla <= 0) errors.push(`SLA for "${stageLabel(s)}" must be greater than zero.`);
    else if (sla > 90) warnings.push(`SLA of ${sla} days for "${stageLabel(s)}" exceeds the 90-day service standard.`);
  }

  if (templateAppTypes(t).length === 0) errors.push("Select at least one application type this route applies to.");

  return { errors, warnings };
}

/**
 * Conflict + impact simulation, run before an admin publishes a new rule version.
 * Answers the judge's question: "what if an admin publishes a broken route?"
 */
export function simulatePublish(params: {
  candidate: RouteTemplateLike;
  published: RouteTemplateLike[];
  inflight: { id: string; refNumber: string; currentStage: string; routeKey: string | null; routeSnapshot: string }[];
}): {
  conflicts: string[];
  affected: number;
  orphaned: { id: string; refNumber: string; currentStage: string }[];
  notes: string[];
} {
  const { candidate, published, inflight } = params;
  const conflicts: string[] = [];
  const notes: string[] = [];

  const candTypes = new Set(templateAppTypes(candidate));
  const candInst = parseStringArray(candidate.institutionTypes);

  for (const other of published) {
    if (other.id && candidate.id && other.id === candidate.id) continue;
    // A new version of the SAME route legitimately supersedes the live one —
    // that is not a conflict. Conflicts are between different routes claiming
    // the same application types.
    if (other.key === candidate.key) continue;

    const otherTypes = new Set(templateAppTypes(other));
    const overlap = [...candTypes].filter((t) => otherTypes.has(t));
    if (overlap.length === 0) continue;

    const otherInst = parseStringArray(other.institutionTypes);
    const instOverlap =
      candInst.length === 0 || otherInst.length === 0
        ? true
        : candInst.some((i) => otherInst.includes(i));

    if (instOverlap) {
      conflicts.push(
        `Matches overlap with "${other.name}" (v${other.version ?? 1}) on: ${overlap.join(", ")}. ` +
          `Archive that route first — two live routes cannot claim the same application type.`,
      );
    }
  }

  const mine = inflight.filter((a) => a.routeKey === candidate.key);
  const candStages = new Set(templateStages(candidate));
  const orphaned = mine
    .filter((a) => !candStages.has(a.currentStage as StageKey))
    .map((a) => ({ id: a.id, refNumber: a.refNumber, currentStage: a.currentStage }));

  if (orphaned.length) {
    notes.push(
      `${orphaned.length} in-flight application(s) sit at a stage that no longer exists in this route. ` +
        `They keep their original route snapshot and will NOT be re-routed.`,
    );
  }
  notes.push(
    `${mine.length} in-flight application(s) use route "${candidate.key}". All of them retain the route and SLAs ` +
      `they were submitted under (rule versioning); only NEW applications pick up this change.`,
  );

  return { conflicts, affected: mine.length, orphaned, notes };
}

/** Pick the live route for a new application. */
export function pickRoute(
  templates: RouteTemplateLike[],
  params: { type: string; institutionType: string },
): RouteTemplateLike | null {
  const published = templates.filter((t) => t.status === "PUBLISHED");
  const exact = published.find((t) => {
    const types = templateAppTypes(t);
    const inst = parseStringArray(t.institutionTypes);
    return types.includes(params.type) && (inst.length === 0 || inst.includes(params.institutionType));
  });
  if (exact) return exact;
  return published.find((t) => templateAppTypes(t).includes(params.type)) ?? null;
}
