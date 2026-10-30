import { requireUser } from "@/lib/session";
import { ensureTick } from "@/lib/scheduler";
import { AppShell } from "@/components/app-shell";
import { ChatWidget } from "@/components/chat-widget";
import { suggestionsFor } from "@/lib/chat-fallback";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // The deadline engine runs lazily: every authenticated page render gives it a
  // chance to fire reminders and climb the escalation ladder. Idempotent + throttled.
  await ensureTick();

  return (
    <AppShell user={user}>
      {children}
      {/* Feature 7 — one assistant, aware of whatever page is open */}
      <ChatWidget suggestions={suggestionsFor(user.role)} />
    </AppShell>
  );
}
