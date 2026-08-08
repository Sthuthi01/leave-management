import type { Role } from "@/types";
import { isManagerial } from "@/lib/rbac";
import {
  LayoutDashboardIcon,
  PlaneTakeoffIcon,
  ListChecksIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  BarChart3Icon,
  UsersIcon,
  BuildingIcon,
  TagsIcon,
  PartyPopperIcon,
  SettingsIcon,
  ScrollTextIcon,
  BookOpenIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Restrict visibility to these roles; omit to show to everyone. */
  roles?: Role[];
  /** Only show to people who have at least one direct report. */
  managersOnly?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
  roles?: Role[];
}

export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [{ label: "Dashboard", href: "/", icon: LayoutDashboardIcon }],
  },
  {
    label: "Leave",
    items: [
      { label: "Apply Leave", href: "/leave/apply", icon: PlaneTakeoffIcon },
      { label: "My Leaves", href: "/leave/my-leaves", icon: ListChecksIcon },
      { label: "Team Calendar", href: "/leave/team-calendar", icon: CalendarDaysIcon },
    ],
  },
  {
    label: "Approvals",
    items: [{ label: "My Approvals", href: "/approvals", icon: ClipboardCheckIcon, managersOnly: true }],
  },
  {
    label: "Onboarding",
    items: [
      { label: "Resource Library", href: "/onboarding/resources", icon: BookOpenIcon },
      { label: "My Checklist", href: "/onboarding/checklist", icon: ClipboardListIcon },
    ],
  },
  {
    label: null,
    items: [{ label: "Reports", href: "/reports", icon: BarChart3Icon, roles: ["ADMIN"] }],
  },
  {
    label: "Administration",
    roles: ["ADMIN"],
    items: [
      { label: "Employees", href: "/administration/employees", icon: UsersIcon },
      { label: "Departments", href: "/administration/departments", icon: BuildingIcon },
      { label: "Leave Types & Policies", href: "/administration/leave-types", icon: TagsIcon },
      { label: "Holidays", href: "/administration/holidays", icon: PartyPopperIcon },
      { label: "Onboarding Content", href: "/administration/onboarding", icon: GraduationCapIcon },
      { label: "Audit Log", href: "/administration/audit-log", icon: ScrollTextIcon },
      { label: "Settings", href: "/administration/settings", icon: SettingsIcon },
    ],
  },
];

export function visibleNavGroups(user: { role: Role; directReportsCount: number }): NavGroup[] {
  const isManager = isManagerial(user);
  return navGroups
    .filter((g) => !g.roles || g.roles.includes(user.role))
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (!i.roles || i.roles.includes(user.role)) && (!i.managersOnly || isManager)),
    }))
    .filter((g) => g.items.length > 0);
}
