import { runSchedulerTick } from "@/lib/scheduler";
import { DEMO_MODE, DEMO_DAY_MS } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Trigger the deadline engine on demand (polled by the Demo Ticker). */
export async function POST() {
  await runSchedulerTick();
  return Response.json({ ok: true, at: new Date().toISOString(), demoMode: DEMO_MODE, demoDayMs: DEMO_DAY_MS });
}

export async function GET() {
  return Response.json({ ok: true, demoMode: DEMO_MODE, demoDayMs: DEMO_DAY_MS });
}
