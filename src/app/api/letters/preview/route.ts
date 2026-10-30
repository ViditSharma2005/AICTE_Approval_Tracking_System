import { getUser } from "@/lib/session";
import { db } from "@/lib/db";
import { generateLetter, LETTER_META, type LetterType } from "@/lib/letters";

export const dynamic = "force-dynamic";

/** Feature 8 — render a draft letter for review. Nothing is saved or sent. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const sp = new URL(request.url).searchParams;
  const applicationId = sp.get("applicationId") ?? "";
  const type = sp.get("type") ?? "" as LetterType;
  if (!applicationId || !(type in LETTER_META)) return new Response("Missing type or application", { status: 400 });

  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, refNumber: true, assignedTo: { select: { name: true, designation: true } } },
  });
  if (!app) return new Response("Not found", { status: 404 });

  const letter = await generateLetter(type as LetterType, applicationId, {
    name: app.assignedTo?.name ?? user.name,
    designation: app.assignedTo?.designation ?? user.designation,
  });
  return Response.json(letter);
}
