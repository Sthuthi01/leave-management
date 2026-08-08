import type { Role } from "@/types";

/**
 * Single source of truth for role metadata. Adding a new role means adding one entry here —
 * labels, badge colors, and the assignable-role list everywhere else derive from this.
 */
export const ROLE_LABELS: Record<Role, string> = {
  EMPLOYEE: "Employee",
  MANAGER: "Manager",
  ADMIN: "HR Admin",
};

export const ROLE_BADGE_CLASSNAMES: Record<Role, string> = {
  EMPLOYEE: "",
  MANAGER: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-400",
  ADMIN: "",
};

export const ROLE_OPTIONS: { value: Role; label: string }[] = (Object.keys(ROLE_LABELS) as Role[]).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

export const ROLE_FIELD_TOOLTIP = "Controls what this person can see and do across the app.";
export const REPORTING_MANAGER_TOOLTIP = "Who this person's leave requests are routed to for approval.";

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export function isAdmin(user: { role: Role }): boolean {
  return user.role === "ADMIN";
}

/**
 * True if this person should see manager-level views (My Approvals, team leave info) — either
 * because they hold the Manager/Admin role, or because they already have direct reports. The
 * direct-reports fallback exists so nothing that worked before this role existed stops working.
 */
export function isManagerial(user: { role: Role; directReportsCount: number }): boolean {
  return user.role === "MANAGER" || user.role === "ADMIN" || user.directReportsCount > 0;
}
