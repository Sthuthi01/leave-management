"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { TeamCalendarData } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon, PartyPopperIcon } from "lucide-react";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function toISO(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export default function TeamCalendarPage() {
  const { data: user } = useCurrentUser();
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [scope, setScope] = useState<"team" | "company">("team");

  const monthParam = format(monthDate, "yyyy-MM");
  const { data, isPending } = useQuery({
    queryKey: ["team-calendar", monthParam, scope],
    queryFn: () => api.get<TeamCalendarData>(`/team-calendar?month=${monthParam}&scope=${scope}`),
  });

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthDate));
    const end = endOfWeek(endOfMonth(monthDate));
    return eachDayOfInterval({ start, end });
  }, [monthDate]);

  const holidaysByDate = useMemo(() => {
    const map = new Map<string, TeamCalendarData["holidays"][number]>();
    data?.holidays.forEach((h) => map.set(h.date, h));
    return map;
  }, [data]);

  const legend = useMemo(() => {
    const seen = new Map<string, { name: string; color: string }>();
    data?.entries.forEach((e) => seen.set(e.leaveType.id, { name: e.leaveType.name, color: e.leaveType.color }));
    return [...seen.values()];
  }, [data]);

  return (
    <>
      <PageHeader
        title="Team Calendar"
        description={data?.scope === "company" ? "Everyone on approved leave, company-wide." : `Approved leave for ${data?.departmentName ?? "your team"}.`}
        actions={
          user?.role === "ADMIN" ? (
            <Tabs value={scope} onValueChange={(v) => setScope(v as "team" | "company")}>
              <TabsList>
                <TabsTrigger value="team">My Team</TabsTrigger>
                <TabsTrigger value="company">Company</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setMonthDate((d) => subMonths(d, 1))}>
            <ChevronLeftIcon />
          </Button>
          <span className="w-36 text-center text-sm font-medium">{format(monthDate, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setMonthDate((d) => addMonths(d, 1))}>
            <ChevronRightIcon />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setMonthDate(startOfMonth(new Date()))}>
          Today
        </Button>
      </div>

      {isPending ? (
        <Skeleton className="h-[560px] w-full rounded-xl" />
      ) : (
        <Card>
          <CardContent>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border text-center text-xs font-medium text-muted-foreground">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="bg-card py-1.5">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border">
              {days.map((day) => {
                const iso = toISO(day);
                const holiday = holidaysByDate.get(iso);
                const entries = data?.entries.filter((e) => e.startDate <= iso && e.endDate >= iso) ?? [];
                const visible = entries.slice(0, 3);
                const overflow = entries.length - visible.length;
                const inMonth = isSameMonth(day, monthDate);

                return (
                  <div
                    key={iso}
                    className={cn("flex min-h-24 flex-col gap-1 bg-card p-1.5 sm:min-h-28", !inMonth && "bg-muted/40")}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn("flex size-5 items-center justify-center rounded-full text-xs", isToday(day) && "bg-primary text-primary-foreground", !inMonth && "text-muted-foreground")}>
                        {format(day, "d")}
                      </span>
                      {holiday && <PartyPopperIcon className="size-3.5 text-muted-foreground" aria-label={holiday.name} />}
                    </div>
                    {holiday && <p className="truncate text-[10px] font-medium text-muted-foreground" title={holiday.name}>{holiday.name}</p>}
                    <div className="flex flex-col gap-0.5">
                      {visible.map((e, i) => (
                        <div
                          key={`${e.employee.id}-${i}`}
                          className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: `${e.leaveType.color}22`, color: e.leaveType.color }}
                          title={`${e.employee.name} · ${e.leaveType.name}`}
                        >
                          <span className="shrink-0">{initials(e.employee.name)}</span>
                          <span className="truncate">{e.employee.name.split(" ")[0]}</span>
                        </div>
                      ))}
                      {overflow > 0 && <span className="px-1 text-[10px] text-muted-foreground">+{overflow} more</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {legend.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-3">
                {legend.map((l) => (
                  <div key={l.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.name}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
