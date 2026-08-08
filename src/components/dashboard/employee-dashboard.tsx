import Link from "next/link";
import { format, parseISO } from "date-fns";
import type { EmployeeDashboardData } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/leave/status-badge";
import { LeaveTypeDot } from "@/components/leave/leave-type-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PlaneTakeoffIcon, PartyPopperIcon, ClipboardCheckIcon, ListChecksIcon } from "lucide-react";

function fmt(date: string) {
  return format(parseISO(date), "d MMM yyyy");
}

export function EmployeeDashboard({ data }: { data: EmployeeDashboardData }) {
  return (
    <div className="flex flex-col gap-6">
      {data.pendingApprovalsCount > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ClipboardCheckIcon className="size-5 text-primary" />
              <p className="text-sm">
                You have <strong>{data.pendingApprovalsCount}</strong> leave request{data.pendingApprovalsCount === 1 ? "" : "s"} waiting on your approval.
              </p>
            </div>
            <Button size="sm" nativeButton={false} render={<Link href="/approvals" />}>
              Review now
            </Button>
          </CardContent>
        </Card>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Leave balance</h2>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/leave/apply" />}>
            <PlaneTakeoffIcon /> Apply Leave
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.balances.map((b) => {
            const pct = b.allocated > 0 ? Math.min(100, Math.round((b.used / b.allocated) * 100)) : 0;
            return (
              <Card key={b.leaveType.id} size="sm">
                <CardContent className="flex flex-col gap-2">
                  <Tooltip>
                    <TooltipTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground outline-none">
                      <LeaveTypeDot color={b.leaveType.color} />
                      {b.leaveType.code}
                    </TooltipTrigger>
                    <TooltipContent>{b.leaveType.name}</TooltipContent>
                  </Tooltip>
                  <div className="text-xl font-semibold">
                    {b.remaining}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">/ {b.allocated} left</span>
                  </div>
                  {b.allocated > 0 && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: b.leaveType.color }} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecksIcon className="size-4" /> Recent requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentRequests.length === 0 ? (
              <EmptyState icon={PlaneTakeoffIcon} title="No leave requests yet" description="Apply for your first leave to see it show up here." />
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {data.recentRequests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <LeaveTypeDot color={r.leaveType.color} />
                        {r.leaveType.name}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {fmt(r.startDate)} – {fmt(r.endDate)} · {r.days} day{r.days === 1 ? "" : "s"}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlaneTakeoffIcon className="size-4" /> Upcoming leave
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.upcomingLeave.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.upcomingLeave.map((r) => (
                    <div key={r.id} className="text-sm">
                      <div className="font-medium">{fmt(r.startDate)} – {fmt(r.endDate)}</div>
                      <div className="text-xs text-muted-foreground">{r.leaveType.name}</div>
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
    </div>
  );
}
