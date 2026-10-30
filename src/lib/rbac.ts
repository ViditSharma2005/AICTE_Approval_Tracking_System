import type { Role } from "./constants";
import type { SessionUser } from "./session";
import type { Prisma } from "@prisma/client";

/** Roles that see the whole country, not one region. */
export function isNational(user: SessionUser): boolean {
  return ["BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN", "COMPETENT_AUTHORITY"].includes(user.role);
}

/**
 * Row-level scoping, applied to EVERY list query.
 * Institution users see only their own institution; regional staff see their
 * region; national roles see everything.
 */
export function scopeFor(user: SessionUser): Prisma.ApplicationWhereInput {
  if (user.role === "INSTITUTION") return { institutionId: user.institutionId ?? "__none__" };
  if (isNational(user)) return {};
  return { regionId: user.regionId ?? "__none__" };
}

export function institutionScopeFor(user: SessionUser): Prisma.InstitutionWhereInput {
  if (user.role === "INSTITUTION") return { id: user.institutionId ?? "__none__" };
  if (isNational(user)) return {};
  return { regionId: user.regionId ?? "__none__" };
}

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  group: string;
  roles: Role[] | "ALL";
};

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", group: "Main", roles: "ALL" },

  { href: "/institution/submit", label: "Submit Application", icon: "FilePlus2", group: "Applications", roles: ["INSTITUTION"] },
  { href: "/applications", label: "Applications", icon: "FolderOpen", group: "Applications", roles: "ALL" },
  { href: "/evc", label: "EVC Visits", icon: "ClipboardCheck", group: "Applications", roles: ["EVC_COORDINATOR", "EVC_MEMBER", "SCRUTINY_OFFICER", "REGIONAL_OFFICER", "BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN"] },

  { href: "/undertakings", label: "Undertakings", icon: "ListChecks", group: "Compliance", roles: "ALL" },
  { href: "/documents", label: "Document Register", icon: "FileWarning", group: "Compliance", roles: ["INSTITUTION", "COMPLIANCE_OFFICER", "REGIONAL_OFFICER", "BUREAU_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN"] },
  { href: "/escalations", label: "Escalations", icon: "AlertTriangle", group: "Compliance", roles: ["REGIONAL_OFFICER", "BUREAU_OFFICER", "COMPLIANCE_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN"] },

  { href: "/reports", label: "Reports", icon: "BarChart3", group: "Insight", roles: ["REGIONAL_OFFICER", "BUREAU_OFFICER", "COMPLIANCE_OFFICER", "POLICY_ADMIN", "SYSTEM_ADMIN"] },
  { href: "/notifications", label: "Notifications", icon: "Bell", group: "Insight", roles: "ALL" },

  { href: "/admin/rules", label: "Rule Engine (APH)", icon: "GitBranch", group: "Administration", roles: ["POLICY_ADMIN", "SYSTEM_ADMIN"] },
  { href: "/admin/users", label: "Users & Roles", icon: "Users", group: "Administration", roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/audit", label: "Audit Trail", icon: "ShieldCheck", group: "Administration", roles: ["SYSTEM_ADMIN", "POLICY_ADMIN", "COMPLIANCE_OFFICER"] },
];

export function navFor(role: Role): { group: string; items: NavItem[] }[] {
  const items = NAV.filter((n) => n.roles === "ALL" || n.roles.includes(role));
  const groups: { group: string; items: NavItem[] }[] = [];
  for (const item of items) {
    let g = groups.find((x) => x.group === item.group);
    if (!g) {
      g = { group: item.group, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  return groups;
}

/** Guard used by each protected page (defence in depth on top of the nav filter). */
export function canView(role: Role, href: string): boolean {
  const item = NAV.find((n) => href === n.href || href.startsWith(n.href + "/"));
  if (!item) return true;
  return item.roles === "ALL" || item.roles.includes(role);
}

export function homeFor(role: Role): string {
  return "/dashboard";
}
