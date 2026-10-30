import Link from "next/link";
import { Landmark, Bell, LogOut } from "lucide-react";
import { ROLE_LABELS } from "@/lib/constants";
import type { SessionUser } from "@/lib/session";
import { Avatar, cn } from "./ui";
import { NavSidebar } from "./nav-sidebar";
import { DemoTicker } from "./client";
import { unreadCount } from "@/lib/notify";
import { logoutAction } from "@/app/actions/auth";
import { navFor } from "@/lib/rbac";

export async function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const unread = await unreadCount(user.id);
  const groups = navFor(user.role);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Government trust strip */}
      <div className="gov-strip no-print">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="seal-ring flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
              <Landmark className="h-4 w-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-[13px] font-semibold tracking-tight">
                AICTE — Approval &amp; Compliance Command Centre
              </p>
              <p className="text-[10px] uppercase tracking-wider text-white/60">
                All India Council for Technical Education · Approval Bureau
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-4 text-[11px] text-white/70 sm:flex">
            <span className="hidden md:inline">Government of India</span>
            <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/80">
              {process.env.DEMO_MODE === "true" ? "DEMO TIME-COMPRESSION ON" : "PROTOTYPE BUILD"}
            </span>
          </div>
        </div>
      </div>
      <div className="tricolor no-print" />

      {/* Sticky application bar */}
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-5">
          <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
            <span className="truncate text-sm font-semibold text-navy">Approval Process Handbook Workflow</span>
            <span className="chip">v2026.1</span>
          </div>

          {/* Mobile nav */}
          <div className="flex flex-1 gap-1 overflow-x-auto md:hidden">
            {groups.flatMap((g) => g.items).map((item) => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-slate-100">
                {item.label}
              </Link>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <DemoTicker />
            <Link
              href="/notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft hover:bg-slate-100"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unread > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white tnum">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Link>

            <div className="hidden sm:block">
              <Avatar name={user.name} role={ROLE_LABELS[user.role] ?? user.role} />
            </div>

            <form action={logoutAction}>
              <button type="submit" className="btn-ghost btn-sm" title="Sign out">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        <NavSidebar role={user.role} unread={unread} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-ink sm:text-[22px]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-soft">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div> : null}
    </div>
  );
}
