import { getUser } from "@/lib/session";
import { getTrustBreakdown } from "@/lib/trust";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Read-only breakdown behind the trust badge. Respects row-level scoping. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const institutionId = new URL(request.url).searchParams.get("institutionId") ?? "";
  if (!institutionId) return new Response("Missing institutionId", { status: 400 });

  // Institutions may only ever inspect themselves.
  if (user.role === "INSTITUTION" && user.institutionId !== institutionId) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role) && user.regionId) {
    const inst = await db.institution.findUnique({ where: { id: institutionId }, select: { regionId: true } });
    if (!inst || inst.regionId !== user.regionId) return new Response("Forbidden", { status: 403 });
  }

  const data = await getTrustBreakdown(institutionId);
  if (!data) return new Response("Not found", { status: 404 });
  return Response.json(data);
}
