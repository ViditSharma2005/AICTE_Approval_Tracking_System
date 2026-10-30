import { getUser } from "@/lib/session";
import { db } from "@/lib/db";
import { proposePanel } from "@/lib/evc-matcher";
import { addDays } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Feature 4 — a ranked panel proposal for one visit.
 * Read-only: the coordinator reviews this and confirms (or swaps) before saving.
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!["EVC_COORDINATOR", "REGIONAL_OFFICER", "SYSTEM_ADMIN", "BUREAU_OFFICER"].includes(user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const visitId = new URL(request.url).searchParams.get("visitId") ?? "";
  if (!visitId) return new Response("Missing visitId", { status: 400 });

  const visit = await db.evcVisit.findUnique({
    where: { id: visitId },
    include: {
      application: {
        select: {
          id: true,
          refNumber: true,
          institution: {
            select: { id: true, name: true, city: true, state: true, latitude: true, longitude: true, trustScore: true },
          },
        },
      },
    },
  });
  if (!visit) return new Response("Not found", { status: 404 });

  const start = visit.scheduledFor ?? new Date();
  const proposal = await proposePanel({
    college: visit.application.institution,
    trustScore: visit.application.institution.trustScore,
    windowStart: start,
    windowEnd: addDays(start, 2),
  });

  return Response.json({
    visitId: visit.id,
    refNumber: visit.application.refNumber,
    institution: visit.application.institution,
    scheduledFor: visit.scheduledFor?.toISOString() ?? null,
    dueAt: visit.dueAt?.toISOString() ?? null,
    proposal,
  });
}
