"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { visibleNavGroups } from "@/lib/nav-config";
import type { Role } from "@/types";

export function AppSidebarNav({ user, onNavigate }: { user: { role: Role; directReportsCount: number }; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = visibleNavGroups(user);

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map((group, idx) => (
        <div key={group.label ?? `group-${idx}`}>
          {group.label && <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</div>}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
