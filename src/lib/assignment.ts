/**
 * Feature 5 — officer workload cap.
 *
 * Cases are assigned to the least-loaded officer who is still under their cap.
 * When everybody is full the case is NOT silently dumped on somebody: it stays
 * in the unassigned queue and the Regional Officer is told to rebalance.
 * Overriding the cap is possible, but only with a recorded reason.
 */

import { db } from "./db";
import { STAGES } from "./constants";
import type { Role, StageKey } from "./constants";
import { notifyRole } from "./notify";

export const DEFAULT_MAX_ACTIVE_CASES = 10;

/** Stages that are "live" work for the officer who owns them. */
const ACTIVE_STAGES: StageKey[] = ["SCRUTINY", "RE_SCRUTINY", "EVC", "COMMITTEE", "DECISION"];

/** Stages a given role owns anything at. */
export function stagesOwnedBy(role: Role | string): StageKey[] {
  return ACTIVE_STAGES.filter((s) => (STAGES[s].owner as string) === role);
}

export type OfficerLoad = {
  id: string;
  name: string;
  email: string;
  activeCases: number;
  maxActiveCases: number;
  atCapacity: boolean;
};

/**
 * How many live cases an officer is carrying: applications sitting at a stage
 * their role owns AND assigned to them.
 */
export async function activeCaseCount(officerId: string, role: Role | string): Promise<number> {
  return db.application.count({
    where: {
      assignedToId: officerId,
      currentStage: { in: stagesOwnedBy(role) },
      status: { in: ["IN_PROGRESS", "AWAITING_INSTITUTION"] },
    },
  });
}

/** Every officer of a role in a region, with their load. Sorted lightest first. */
export async function officerLoads(role: Role | string, regionId: string | null): Promise<OfficerLoad[]> {
  const officers = await db.user.findMany({
    where: {
      role: role as string,
      ...(regionId ? { regionId } : {}),
    },
    select: { id: true, name: true, email: true, maxActiveCases: true },
    orderBy: { createdAt: "asc" },
  });

  return Promise.all(
    officers.map(async (o) => {
      const activeCases = await activeCaseCount(o.id, role);
      return {
        id: o.id,
        name: o.name,
        email: o.email,
        activeCases,
        maxActiveCases: o.maxActiveCases || DEFAULT_MAX_ACTIVE_CASES,
        atCapacity: activeCases >= (o.maxActiveCases || DEFAULT_MAX_ACTIVE_CASES),
      };
    }),
  ).then((rows) => rows.sort((a, b) => a.activeCases - b.activeCases || a.name.localeCompare(b.name)));
}

/**
 * Least-loaded officer under their cap, or null when the whole pool is full.
 * `null` is a meaningful result — the caller must keep the case in the queue.
 */
export async function findAvailableOfficer(
  role: Role | string,
  regionId: string | null,
): Promise<OfficerLoad | null> {
  const loads = await officerLoads(role, regionId);
  return loads.find((l) => !l.atCapacity) ?? null;
}

/** Tell the regional office that a region's officer pool is saturated. */
export async function notifyPoolAtCapacity(args: {
  role: Role | string;
  regionId: string | null;
  refNumber: string;
}): Promise<void> {
  await notifyRole(
    "REGIONAL_OFFICER",
    {
      type: "CAPACITY_FULL",
      title: `All ${args.role.replace(/_/g, " ").toLowerCase()}s at capacity`,
      body: `${args.refNumber} is waiting in the unassigned queue — every officer in this region is carrying their maximum active caseload. Rebalance the workload or raise a cap.`,
      link: "/applications?mine=0",
    },
    args.regionId,
  );
}

/** Load for one officer, for the capacity bar on their dashboard. */
export async function myLoad(
  user: { id: string; role: Role | string; maxActiveCases?: number },
): Promise<OfficerLoad> {
  const activeCases = await activeCaseCount(user.id, user.role);
  const max = user.maxActiveCases || DEFAULT_MAX_ACTIVE_CASES;
  return {
    id: user.id,
    name: "You",
    email: "",
    activeCases,
    maxActiveCases: max,
    atCapacity: activeCases >= max,
  };
}
