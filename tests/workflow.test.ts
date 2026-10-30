import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNext, validateTemplate, simulatePublish, availableActions, effectiveStage, type RouteTemplateLike } from "../src/lib/workflow";
import { priorityScore } from "../src/lib/priority";
import { toJson } from "../src/lib/json";

const ROUTE_NEW = ["SCRUTINY", "EVC", "COMMITTEE", "DECISION"] as const;
const ROUTE_RENEWAL = ["SCRUTINY", "DECISION"] as const;

test("approving a stage moves the case to the next stage on its route", () => {
  const r = computeNext({ action: "APPROVE_STAGE", currentStage: "SCRUTINY", route: [...ROUTE_NEW] as never });
  assert.deepEqual(r, { toStage: "EVC", newStatus: "IN_PROGRESS", terminal: false });
});

test("a revert or rejection is refused without a recorded reason", () => {
  assert.match(
    (computeNext({ action: "REVERT", currentStage: "SCRUTINY", route: [...ROUTE_NEW] as never }) as { error: string }).error,
    /reason/i,
  );
  assert.match(
    (computeNext({ action: "REJECT", currentStage: "DECISION", route: [...ROUTE_NEW] as never }) as { error: string }).error,
    /reason/i,
  );
});

test("a deficiency sends the case back to the institution", () => {
  const r = computeNext({ action: "REVERT", currentStage: "SCRUTINY", route: [...ROUTE_NEW] as never, reason: "Land deed missing" });
  assert.deepEqual(r, { toStage: "INSTITUTION_RESPONSE", newStatus: "AWAITING_INSTITUTION", terminal: false });
});

test("an institution reply returns the case to re-scrutiny", () => {
  const r = computeNext({ action: "RESUBMIT", currentStage: "INSTITUTION_RESPONSE", route: [...ROUTE_NEW] as never });
  assert.deepEqual(r, { toStage: "RE_SCRUTINY", newStatus: "IN_PROGRESS", terminal: false });
});

test("re-scrutiny resumes the route from the scrutiny slot", () => {
  assert.equal(effectiveStage("RE_SCRUTINY"), "SCRUTINY");
  const r = computeNext({ action: "APPROVE_STAGE", currentStage: "RE_SCRUTINY", route: [...ROUTE_RENEWAL] as never });
  assert.deepEqual(r, { toStage: "DECISION", newStatus: "IN_PROGRESS", terminal: false });
});

test("decisions are terminal and carry their own status", () => {
  assert.deepEqual(computeNext({ action: "APPROVE", currentStage: "DECISION", route: [...ROUTE_NEW] as never, reason: "ok" }), {
    toStage: "COMPLETED",
    newStatus: "APPROVED",
    terminal: true,
  });
  assert.deepEqual(
    computeNext({ action: "CONDITIONAL_APPROVE", currentStage: "DECISION", route: [...ROUTE_NEW] as never, reason: "ok" }),
    { toStage: "COMPLETED", newStatus: "CONDITIONALLY_APPROVED", terminal: true },
  );
  assert.deepEqual(computeNext({ action: "REJECT", currentStage: "DECISION", route: [...ROUTE_NEW] as never, reason: "not met" }), {
    toStage: "COMPLETED",
    newStatus: "REJECTED",
    terminal: true,
  });
});

test("a route with no decision stage cannot be published", () => {
  const t: RouteTemplateLike = {
    key: "R",
    name: "broken",
    stages: toJson(["SCRUTINY", "EVC"]),
    slaDays: toJson({ SCRUTINY: 7, EVC: 21 }),
    appTypes: toJson(["RENEWAL"]),
  };
  const { errors } = validateTemplate(t);
  assert.ok(errors.some((e) => /DECISION/.test(e)), "expected a DECISION-stage error");
});

test("duplicate stages are rejected", () => {
  const t: RouteTemplateLike = {
    key: "R",
    name: "loop",
    stages: toJson(["SCRUTINY", "EVC", "EVC", "DECISION"]),
    slaDays: toJson({ SCRUTINY: 7, EVC: 21, DECISION: 10 }),
    appTypes: toJson(["RENEWAL"]),
  };
  const { errors } = validateTemplate(t);
  assert.ok(errors.some((e) => /more than once/.test(e)));
});

test("a missing SLA is rejected", () => {
  const t: RouteTemplateLike = {
    key: "R",
    name: "no sla",
    stages: toJson(["SCRUTINY", "DECISION"]),
    slaDays: toJson({ SCRUTINY: 7 }),
    appTypes: toJson(["RENEWAL"]),
  };
  const { errors } = validateTemplate(t);
  assert.ok(errors.some((e) => /No SLA/.test(e)));
});

test("two different live routes claiming the same application type conflict", () => {
  const candidate: RouteTemplateLike = {
    id: "c",
    key: "ROUTE_B",
    name: "other route",
    stages: toJson(["SCRUTINY", "DECISION"]),
    slaDays: toJson({ SCRUTINY: 7, DECISION: 10 }),
    appTypes: toJson(["RENEWAL"]),
  };
  const live: RouteTemplateLike = {
    id: "l",
    key: "ROUTE_A",
    name: "live route",
    stages: toJson(["SCRUTINY", "DECISION"]),
    slaDays: toJson({ SCRUTINY: 7, DECISION: 10 }),
    appTypes: toJson(["RENEWAL"]),
  };
  const sim = simulatePublish({ candidate, published: [live], inflight: [] });
  assert.equal(sim.conflicts.length, 1);
});

test("a new version of the same route supersedes the live one without a conflict", () => {
  const candidate: RouteTemplateLike = {
    id: "c2",
    key: "ROUTE_A",
    name: "v2",
    stages: toJson(["SCRUTINY", "DECISION"]),
    slaDays: toJson({ SCRUTINY: 5, DECISION: 7 }),
    appTypes: toJson(["RENEWAL"]),
  };
  const live: RouteTemplateLike = { ...candidate, id: "c1" };
  const sim = simulatePublish({
    candidate,
    published: [live],
    inflight: [{ id: "a1", refNumber: "X", currentStage: "SCRUTINY", routeKey: "ROUTE_A", routeSnapshot: toJson(["SCRUTINY", "DECISION"]) }],
  });
  assert.equal(sim.conflicts.length, 0);
  assert.equal(sim.affected, 1);
  assert.equal(sim.orphaned.length, 0);
});

test("simulation flags applications stranded on a stage the new route removes", () => {
  const candidate: RouteTemplateLike = {
    id: "c2",
    key: "ROUTE_A",
    name: "v2",
    stages: toJson(["SCRUTINY", "DECISION"]),
    slaDays: toJson({ SCRUTINY: 5, DECISION: 7 }),
    appTypes: toJson(["RENEWAL"]),
  };
  const sim = simulatePublish({
    candidate,
    published: [],
    inflight: [{ id: "a1", refNumber: "X", currentStage: "EVC", routeKey: "ROUTE_A", routeSnapshot: toJson(["SCRUTINY", "EVC", "DECISION"]) }],
  });
  assert.equal(sim.orphaned.length, 1);
});

test("only the owning role may act at a stage", () => {
  assert.ok(availableActions({ role: "SCRUTINY_OFFICER", stage: "SCRUTINY" }).includes("APPROVE_STAGE"));
  assert.ok(!availableActions({ role: "SCRUTINY_OFFICER", stage: "DECISION" }).length);
  assert.ok(!availableActions({ role: "REGIONAL_OFFICER", stage: "SCRUTINY" }).length, "supervisors are read-only by design");
  assert.deepEqual(availableActions({ role: "INSTITUTION", stage: "INSTITUTION_RESPONSE" }), ["RESUBMIT"]);
  assert.deepEqual(availableActions({ role: "EVC_COORDINATOR", stage: "EVC", evcStatus: "QUEUED" }), ["REVERT"]);
  assert.ok(availableActions({ role: "EVC_COORDINATOR", stage: "EVC", evcStatus: "COMPLETED" }).includes("APPROVE_STAGE"));
});

test("the priority score is explainable", () => {
  const r = priorityScore({
    dueAt: new Date(Date.now() - 3 * 86400000),
    escalationLevel: 1,
    stageEnteredAt: new Date(Date.now() - 20 * 86400000),
    evcStatus: "OVERDUE",
    overdueUndertakings: 2,
  });
  assert.ok(r.score > 0);
  assert.equal(r.score, r.reasons.reduce((s, x) => s + x.points, 0));
  assert.ok(r.reasons.some((x) => /past SLA/.test(x.label)));
  assert.equal(r.band, "CRITICAL");
});
