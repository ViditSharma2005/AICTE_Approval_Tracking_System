import { confirmPanel } from "@/app/actions/evc";

export const dynamic = "force-dynamic";

/**
 * Feature 4 — save the panel the coordinator confirmed.
 * Wraps the server action so the review dialog can submit its (possibly edited)
 * selection without a page round-trip.
 */
export async function POST(request: Request) {
  let body: { visitId?: string; selections?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!body.visitId || !Array.isArray(body.selections)) {
    return Response.json({ error: "visitId and selections are required." }, { status: 400 });
  }

  const fd = new FormData();
  fd.set("visitId", body.visitId);
  fd.set("selections", JSON.stringify(body.selections));

  const result = await confirmPanel({}, fd);
  if (result.error) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
