"use client";

import type { ElementType, ReactNode } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { HrDashboardData } from "@/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/leave/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { DecisionDialog } from "@/components/approvals/decision-dialog";
import {
  UsersIcon,
  ClipboardCheckIcon,
  CalendarOffIcon,
  CalendarDaysIcon,
  BuildingIcon,
  PartyPopperIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ActivityIcon,
} from "lucide-react";

function fmt(date: string) {
  return format(parseISO(date), "d MMM");
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function StatCard({ label, value, icon: Icon, href }: { label: string; value: number | string; icon: ElementType; href: string }) {
  return (
    <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      <Card size="sm" className="transition-colors hover:border-primary/50 hover:bg-accent/40">
        <CardContent className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </div>
          <div>
            <div className="text-xl font-semibold leading-tight">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function SectionLabel({ children, count }: { children: ReactNode; count: number }) {
  return (
    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children} ({count})
    </p>
  );
}

export function HrDashboard({ data }: { data: HrDashboardData }) {
  const { data: currentUser } = useCurrentUser();

  const chartData = data.leaveUtilization.map((u) => ({
    name: u.leaveType.code,
    Used: u.used,
    Remaining: Math.max(0, u.allocated - u.used),
    color: u.leaveType.color,
  }));

  const hasAttention = data.attentionPendingApprovals.length > 0 || data.employeesWithoutManager.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* KPIs — each links to where you'd actually go to act on it */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total employees" value={data.totalEmployees} icon={UsersIcon} href="/administration/employees" />
        <StatCard label="On leave today" value={data.onLeaveToday.length} icon={CalendarOffIcon} href="/leave/team-calendar" />
        <StatCard label="On leave this week" value={data.onLeaveThisWeek} icon={CalendarDaysIcon} href="/leave/team-calendar" />
        <StatCard label="Pending approvals" value={data.pendingApprovalsCount} icon={ClipboardCheckIcon} href="/approvals" />
      </div>

      {/* Attention required — the one place that should surface what actually needs a human to act */}
      <Card className={cn(hasAttention && "border-amber-300/70 dark:border-amber-500/30")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangleIcon className={cn("size-4", hasAttention ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} />
            Attention required
          </CardTitle>
          <CardDescription>Approvals that are overdue or starting soon, and data gaps that block leave requests.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!hasAttention ? (
            <EmptyState icon={CheckCircle2Icon} title="All clear" description="Nothing needs your attention right now." />
          ) : (
            <>
              {data.attentionPendingApprovals.length > 0 && (
                <div className="flex flex-col gap-2">
                  <SectionLabel count={data.attentionPendingApprovals.length}>Pending approvals</SectionLabel>
                  <div className="flex flex-col divide-y divide-border">
                    {data.attentionPendingApprovals.map((item) => (
                      <div key={item.request.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar className="size-7 shrink-0">
                            <AvatarFallback className="text-[10px]">{initials(item.request.employee.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{item.request.employee.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.request.leaveType.name} · {fmt(item.request.startDate)} – {fmt(item.request.endDate)}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {item.daysUntilStart <= 2 && (
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400">
                              {item.daysUntilStart <= 0 ? "Starts today" : `Starts in ${item.daysUntilStart}d`}
                            </Badge>
                          )}
                          {item.daysPending >= 1 && (
                            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
                              Pending {item.daysPending}d
                            </Badge>
                          )}
                          {currentUser && item.request.approverId === currentUser.id ? (
                            <DecisionDialog request={item.request} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Awaiting {item.request.approver?.name ?? "their manager"}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.employeesWithoutManager.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <SectionLabel count={data.employeesWithoutManager.length}>No manager assigned</SectionLabel>
                    <Link href="/administration/employees" className="text-xs font-medium text-primary hover:underline">
                      Fix in Employees →
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.employeesWithoutManager.map((e) => (
                      <span key={e.id} className="rounded-full border border-border px-2.5 py-1 text-xs">
                        {e.name} <span className="text-muted-foreground">· {e.title}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Leave utilization</CardTitle>
            <CardDescription>Days used vs. remaining allocation, company-wide, {new Date().getFullYear()}.</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barSize={28}>
                <CartesianGrid vertical={false} strokeOpacity={0.15} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={28} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: "var(--muted)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Used" stackId="a" fill="var(--color-chart-2)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Remaining" stackId="a" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BuildingIcon className="size-4" /> Department breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {data.departmentStats.map((d) => {
              const share = data.totalEmployees > 0 ? Math.round((d.employeeCount / data.totalEmployees) * 100) : 0;
              return (
                <Link
                  key={d.department.id}
                  href={`/administration/employees?search=${encodeURIComponent(d.department.name)}`}
                  className="-mx-2 flex flex-col gap-1.5 rounded-md px-2 py-2.5 transition-colors first:pt-0 last:pb-0 hover:bg-accent/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{d.department.name}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {d.onLeaveToday > 0 && (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
                          {d.onLeaveToday} on leave
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{d.employeeCount} people</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon className="size-4" /> Recent activity
            </CardTitle>
            <CardDescription>The latest leave requests and decisions across the company.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentRequests.length === 0 ? (
              <EmptyState icon={ActivityIcon} title="No activity yet" description="Leave requests will show up here as they come in." />
            ) : (
              <div className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto">
                {data.recentRequests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar className="size-7 shrink-0">
                        <AvatarFallback className="text-[10px]">{initials(r.employee.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.employee.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.leaveType.name} · {fmt(r.startDate)} – {fmt(r.endDate)}
                        </div>
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PartyPopperIcon className="size-4" /> Upcoming holidays
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.upcomingHolidays.length === 0 ? (
              <p className="text-sm text-muted-foreground">No holidays scheduled.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.upcomingHolidays.map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-sm">
                    <span>{h.name}</span>
                    <span className="text-xs text-muted-foreground">{fmt(h.date)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
