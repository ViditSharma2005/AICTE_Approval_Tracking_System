import { markLetterSent } from "@/app/actions/letters";

export const dynamic = "force-dynamic";

/** Feature 8 — an officer has reviewed the draft and is issuing it. */
export async function POST(request: Request) {
  let body: { applicationId?: string; type?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!body.applicationId || !body.type) {
    return Response.json({ error: "applicationId and type are required." }, { status: 400 });
  }

  const fd = new FormData();
  fd.set("applicationId", body.applicationId);
  fd.set("type", body.type);

  const result = await markLetterSent({}, fd);
  if (result.error) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
