"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FilePlus2,
  FolderOpen,
  ClipboardCheck,
  ListChecks,
  FileWarning,
  AlertTriangle,
  BarChart3,
  Bell,
  GitBranch,
  Users,
  ShieldCheck,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { navFor } from "@/lib/rbac";
import type { Role } from "@/lib/constants";
import { cn } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  FilePlus2,
  FolderOpen,
  ClipboardCheck,
  ListChecks,
  FileWarning,
  AlertTriangle,
  BarChart3,
  Bell,
  GitBranch,
  Users,
  ShieldCheck,
  Landmark,
};

export function NavSidebar({ role, unread }: { role: Role; unread: number }) {
  const pathname = usePathname();
  const groups = navFor(role);

  return (
    <aside className="no-print hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">
      <nav className="sticky top-14 max-h-[calc(100vh-3.5rem)] space-y-5 overflow-y-auto px-3 py-5">
        {groups.map((g) => (
          <div key={g.group}>
            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{g.group}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-ink-soft hover:bg-slate-50 hover:text-ink",
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active ? "text-indigo-600" : "text-slate-400")} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.href === "/notifications" && unread > 0 ? (
                        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white tnum">
                          {unread}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="mx-1 rounded-lg bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Human-in-the-loop</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            Every statutory decision on this platform is taken by a named officer. Automation only routes, reminds,
            escalates and records.
          </p>
        </div>
      </nav>
    </aside>
  );
}
