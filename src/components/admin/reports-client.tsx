"use client";

import { useMemo, useState } from "react";
import {
  format,
  parseISO,
  subDays,
  subMonths,
  startOfYear,
  startOfWeek,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
} from "date-fns";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { LeaveRequestWithRelations, ReportsData } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { InfoTooltip } from "@/components/shared/info-tooltip";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LeaveTypeDot } from "@/components/leave/leave-type-badge";
import {
  DownloadIcon,
  PlaneTakeoffIcon,
  FileTextIcon,
  CheckCircle2Icon,
  ClockIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  MinusIcon,
  BuildingIcon,
  PieChartIcon,
  LightbulbIcon,
  XIcon,
  RotateCcwIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Date range presets
// ---------------------------------------------------------------------------

type Preset = "last30" | "last3m" | "last6m" | "ytd" | "custom";

const PRESET_LABELS: Record<Preset, string> = {
  last30: "Last 30 days",
  last3m: "Last 3 months",
  last6m: "Last 6 months",
  ytd: "Year to date",
  custom: "Custom range",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function presetRange(preset: Preset): { from: string; to: string } {
  const to = todayISO();
  const now = new Date();
  switch (preset) {
    case "last30":
      return { from: format(subDays(now, 29), "yyyy-MM-dd"), to };
    case "last3m":
      return { from: format(subMonths(now, 3), "yyyy-MM-dd"), to };
    case "last6m":
      return { from: format(subMonths(now, 6), "yyyy-MM-dd"), to };
    case "ytd":
    default:
      return { from: format(startOfYear(now), "yyyy-MM-dd"), to };
  }
}

// ---------------------------------------------------------------------------
// Aggregation helpers (pure functions over the raw request lists the API returns)
// ---------------------------------------------------------------------------

function daysBetweenInclusive(from: string, to: string) {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000) + 1;
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function computeKpis(requests: LeaveRequestWithRelations[]) {
  const active = requests.filter((r) => r.status !== "CANCELLED");
  const approved = requests.filter((r) => r.status === "APPROVED");
  const decided = requests.filter((r) => r.status === "APPROVED" || r.status === "REJECTED");
  const totalDaysTaken = approved.reduce((s, r) => s + r.days, 0);
  const totalRequests = active.length;
  const approvalRate = decided.length > 0 ? Math.round((decided.filter((r) => r.status === "APPROVED").length / decided.length) * 100) : null;
  const avgTurnaroundDays =
    decided.length > 0
      ? decided.reduce((s, r) => s + (parseISO(r.decidedAt!).getTime() - parseISO(r.appliedAt).getTime()) / 86_400_000, 0) / decided.length
      : null;
  return { totalDaysTaken, totalRequests, approvalRate, avgTurnaroundDays };
}

function formatDelta(curr: number | null, prev: number | null) {
  if (curr === null || prev === null) return null;
  if (curr === prev) return { text: "No change vs. previous period", direction: "flat" as const };
  if (prev === 0) return { text: "Up from 0 in the previous period", direction: "up" as const };
  const pct = Math.round(((curr - prev) / prev) * 100);
  const direction: "up" | "down" = pct > 0 ? "up" : "down";
  return { text: `${pct > 0 ? "+" : ""}${pct}% vs. previous period`, direction };
}

function bucketTrend(requests: LeaveRequestWithRelations[], from: string, to: string) {
  const approved = requests.filter((r) => r.status === "APPROVED");
  const span = daysBetweenInclusive(from, to);
  const start = parseISO(from);
  const end = parseISO(to);

  let buckets: { key: string; label: string }[];
  let keyOf: (dateStr: string) => string;

  if (span <= 14) {
    buckets = eachDayOfInterval({ start, end }).map((d) => ({ key: format(d, "yyyy-MM-dd"), label: format(d, "d MMM") }));
    keyOf = (dateStr) => dateStr;
  } else if (span <= 90) {
    buckets = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((d) => ({
      key: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      label: `Wk of ${format(d, "d MMM")}`,
    }));
    keyOf = (dateStr) => format(startOfWeek(parseISO(dateStr), { weekStartsOn: 1 }), "yyyy-MM-dd");
  } else {
    buckets = eachMonthOfInterval({ start, end }).map((d) => ({ key: format(d, "yyyy-MM"), label: format(d, "MMM yy") }));
    keyOf = (dateStr) => dateStr.slice(0, 7);
  }

  return buckets.map(({ key, label }) => {
    const inBucket = approved.filter((r) => keyOf(r.startDate) === key);
    return { key, label, days: inBucket.reduce((s, r) => s + r.days, 0), requests: inBucket.length };
  });
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function DeltaBadge({ delta, invert }: { delta: ReturnType<typeof formatDelta>; invert?: boolean }) {
  if (!delta) return <p className="text-xs text-muted-foreground">No data in the previous period.</p>;
  const isGood = delta.direction === "flat" ? null : invert ? delta.direction === "down" : delta.direction === "up";
  const Icon = delta.direction === "flat" ? MinusIcon : delta.direction === "up" ? TrendingUpIcon : TrendingDownIcon;
  return (
    <p
      className={cn(
        "flex items-center gap-1 text-xs",
        isGood === null ? "text-muted-foreground" : isGood ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
      )}
    >
      <Icon className="size-3.5" /> {delta.text}
    </p>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  invert,
  tooltip,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  delta: ReturnType<typeof formatDelta>;
  invert?: boolean;
  tooltip?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </div>
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {label}
            {tooltip && <InfoTooltip text={tooltip} />}
          </span>
        </div>
        <div className="text-2xl font-semibold leading-tight">{value}</div>
        <DeltaBadge delta={delta} invert={invert} />
      </CardContent>
    </Card>
  );
}

const CHART_TOOLTIP_STYLE = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

// ---------------------------------------------------------------------------

export function ReportsClient() {
  const [preset, setPreset] = useState<Preset>("ytd");
  const [customFrom, setCustomFrom] = useState(presetRange("last3m").from);
  const [customTo, setCustomTo] = useState(todayISO());
  const [departmentId, setDepartmentId] = useState<string>("all");
  const [leaveTypeId, setLeaveTypeId] = useState<string>("all");
  const [drilldownDeptId, setDrilldownDeptId] = useState<string | null>(null);

  const { from, to } = preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset);

  const params = new URLSearchParams({ from, to });
  if (departmentId !== "all") params.set("departmentId", departmentId);
  if (leaveTypeId !== "all") params.set("leaveTypeId", leaveTypeId);

  const { data, isPending, isFetching } = useQuery({
    queryKey: ["reports", from, to, departmentId, leaveTypeId],
    queryFn: () => api.get<ReportsData>(`/reports?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const isFiltered = preset !== "ytd" || departmentId !== "all" || leaveTypeId !== "all";

  const kpis = useMemo(() => computeKpis(data?.requests ?? []), [data]);
  const prevKpis = useMemo(() => computeKpis(data?.previousRequests ?? []), [data]);
  const trend = useMemo(() => bucketTrend(data?.requests ?? [], from, to), [data, from, to]);

  const byDepartment = useMemo(() => {
    if (!data) return [];
    const approved = data.requests.filter((r) => r.status === "APPROVED");
    return data.departments
      .map((department) => {
        const deptRequests = data.requests.filter((r) => r.employee.departmentId === department.id && r.status !== "CANCELLED");
        const deptApproved = approved.filter((r) => r.employee.departmentId === department.id);
        return { department, daysTaken: deptApproved.reduce((s, r) => s + r.days, 0), requestCount: deptRequests.length };
      })
      .sort((a, b) => b.daysTaken - a.daysTaken);
  }, [data]);

  const leaveTypeMix = useMemo(() => {
    if (!data) return [];
    const approved = data.requests.filter((r) => r.status === "APPROVED");
    const total = approved.reduce((s, r) => s + r.days, 0);
    return data.leaveTypes
      .map((lt) => {
        const days = approved.filter((r) => r.leaveTypeId === lt.id).reduce((s, r) => s + r.days, 0);
        return { leaveType: lt, days, percentage: total > 0 ? Math.round((days / total) * 100) : 0 };
      })
      .filter((s) => s.days > 0)
      .sort((a, b) => b.days - a.days);
  }, [data]);

  const drilldown = useMemo(() => {
    if (!data || !drilldownDeptId) return [];
    const approved = data.requests.filter((r) => r.status === "APPROVED" && r.employee.departmentId === drilldownDeptId);
    const byEmployee = new Map<string, { employee: LeaveRequestWithRelations["employee"]; days: number; requests: number; types: Map<string, number> }>();
    for (const r of approved) {
      const entry = byEmployee.get(r.employeeId) ?? { employee: r.employee, days: 0, requests: 0, types: new Map<string, number>() };
      entry.days += r.days;
      entry.requests += 1;
      entry.types.set(r.leaveType.name, (entry.types.get(r.leaveType.name) ?? 0) + r.days);
      byEmployee.set(r.employeeId, entry);
    }
    return Array.from(byEmployee.values())
      .map((e) => ({
        employee: e.employee,
        daysTaken: e.days,
        requestCount: e.requests,
        topLeaveType: Array.from(e.types.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      }))
      .sort((a, b) => b.daysTaken - a.daysTaken);
  }, [data, drilldownDeptId]);

  const insights = useMemo(() => {
    if (!data) return [];
    const list: string[] = [];
    const totalDays = byDepartment.reduce((s, d) => s + d.daysTaken, 0);

    if (departmentId === "all" && byDepartment.length > 0 && byDepartment[0].daysTaken > 0) {
      const top = byDepartment[0];
      const pct = totalDays > 0 ? Math.round((top.daysTaken / totalDays) * 100) : 0;
      list.push(
        `${top.department.name} led leave usage this period with ${top.daysTaken} day${top.daysTaken === 1 ? "" : "s"} across ${top.requestCount} request${top.requestCount === 1 ? "" : "s"} (${pct}% of company-wide days).`
      );
      const zero = byDepartment.filter((d) => d.requestCount === 0);
      if (zero.length > 0 && zero.length < byDepartment.length) {
        list.push(`No leave activity recorded for ${zero.map((d) => d.department.name).join(", ")} this period.`);
      }
    }

    if (leaveTypeMix.length > 0) {
      const top = leaveTypeMix[0];
      list.push(`${top.leaveType.name} was the most-used leave type, accounting for ${top.percentage}% of approved leave days.`);
    }

    const daysDelta = formatDelta(kpis.totalDaysTaken, prevKpis.totalDaysTaken);
    if (daysDelta && daysDelta.direction !== "flat" && prevKpis.totalDaysTaken > 0) {
      list.push(`Leave days taken were ${daysDelta.text.replace("vs. previous", "compared with the previous")}.`);
    }

    if (kpis.avgTurnaroundDays !== null && prevKpis.avgTurnaroundDays !== null && prevKpis.avgTurnaroundDays > 0) {
      const deltaDays = kpis.avgTurnaroundDays - prevKpis.avgTurnaroundDays;
      if (Math.abs(deltaDays) >= 0.2) {
        list.push(
          `Average approval turnaround ${deltaDays < 0 ? "improved" : "slowed"} to ${kpis.avgTurnaroundDays.toFixed(1)} day${kpis.avgTurnaroundDays.toFixed(1) === "1.0" ? "" : "s"}, from ${prevKpis.avgTurnaroundDays.toFixed(1)}.`
        );
      }
    }

    return list.slice(0, 4);
  }, [data, byDepartment, leaveTypeMix, kpis, prevKpis, departmentId]);

  function handleExport() {
    if (!data) return;
    const deptName = new Map(data.departments.map((d) => [d.id, d.name]));
    downloadCsv(
      `leave-report_${from}_to_${to}.csv`,
      data.requests.map((r) => ({
        Reference: r.referenceNumber,
        Employee: r.employee.name,
        Department: deptName.get(r.employee.departmentId) ?? "—",
        "Leave type": r.leaveType.name,
        "Start date": r.startDate,
        "End date": r.endDate,
        Days: r.days,
        Status: r.status,
        "Applied at": r.appliedAt.slice(0, 10),
        "Decided at": r.decidedAt?.slice(0, 10) ?? "",
        Approver: r.approver?.name ?? "",
      }))
    );
  }

  function resetFilters() {
    setPreset("ytd");
    setDepartmentId("all");
    setLeaveTypeId("all");
    setDrilldownDeptId(null);
  }

  const showDeptChart = departmentId === "all";
  const activeDrilldownDept = drilldownDeptId ? data?.departments.find((d) => d.id === drilldownDeptId) : null;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Company-wide leave analytics for the selected period."
        actions={
          <Button variant="outline" onClick={handleExport} disabled={!data || data.requests.length === 0}>
            <DownloadIcon /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        {/* Global filters */}
        <Card size="sm">
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-40 flex-col gap-1.5">
              <Label htmlFor="reports-period">Period</Label>
              <Select
                value={preset}
                onValueChange={(v) => v && setPreset(v as Preset)}
                items={Object.entries(PRESET_LABELS).map(([value, label]) => ({ value, label }))}
              >
                <SelectTrigger id="reports-period" className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRESET_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {preset === "custom" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reports-from">From</Label>
                  <Input id="reports-from" type="date" max={customTo} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reports-to">To</Label>
                  <Input id="reports-to" type="date" min={customFrom} max={todayISO()} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              </>
            )}

            <div className="flex min-w-40 flex-col gap-1.5">
              <Label htmlFor="reports-dept">Department</Label>
              <Select
                value={departmentId}
                onValueChange={(v) => {
                  setDepartmentId(v ?? "all");
                  setDrilldownDeptId(null);
                }}
                items={[{ value: "all", label: "All departments" }, ...(data?.departments.map((d) => ({ value: d.id, label: d.name })) ?? [])]}
              >
                <SelectTrigger id="reports-dept" className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {data?.departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-w-40 flex-col gap-1.5">
              <Label htmlFor="reports-type">Leave type</Label>
              <Select
                value={leaveTypeId}
                onValueChange={(v) => setLeaveTypeId(v ?? "all")}
                items={[{ value: "all", label: "All leave types" }, ...(data?.leaveTypes.map((t) => ({ value: t.id, label: t.name })) ?? [])]}
              >
                <SelectTrigger id="reports-type" className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All leave types</SelectItem>
                  {data?.leaveTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <LeaveTypeDot color={t.color} /> {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isFiltered && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
                <RotateCcwIcon /> Reset
              </Button>
            )}

            {isFetching && !isPending && <span className="text-xs text-muted-foreground">Updating…</span>}
          </CardContent>
        </Card>

        {isPending || !data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-80 rounded-xl lg:col-span-2" />
            ))}
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="Leave days taken"
                value={String(kpis.totalDaysTaken)}
                icon={PlaneTakeoffIcon}
                delta={formatDelta(kpis.totalDaysTaken, prevKpis.totalDaysTaken)}
              />
              <KpiCard
                label="Requests submitted"
                value={String(kpis.totalRequests)}
                icon={FileTextIcon}
                delta={formatDelta(kpis.totalRequests, prevKpis.totalRequests)}
              />
              <KpiCard
                label="Approval rate"
                value={kpis.approvalRate === null ? "—" : `${kpis.approvalRate}%`}
                icon={CheckCircle2Icon}
                delta={formatDelta(kpis.approvalRate, prevKpis.approvalRate)}
                tooltip="Share of decided requests that were approved (excludes pending)."
              />
              <KpiCard
                label="Avg. approval time"
                value={kpis.avgTurnaroundDays === null ? "—" : `${kpis.avgTurnaroundDays.toFixed(1)}d`}
                icon={ClockIcon}
                delta={formatDelta(kpis.avgTurnaroundDays, prevKpis.avgTurnaroundDays)}
                invert
                tooltip="Average days between submission and a manager's decision."
              />
            </div>

            {/* Insights */}
            {insights.length > 0 && (
              <Card size="sm">
                <CardContent className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <LightbulbIcon className="size-4 text-primary" /> Insights
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {insights.map((text, i) => (
                      <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                        <span className="text-primary">•</span> {text}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Trend + leave type mix */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUpIcon className="size-4" /> Leave days over time
                  </CardTitle>
                  <CardDescription>Approved leave days taken, {PRESET_LABELS[preset].toLowerCase()}.</CardDescription>
                </CardHeader>
                <CardContent className="h-64">
                  {trend.every((t) => t.days === 0) ? (
                    <EmptyState icon={TrendingUpIcon} title="No leave taken" description="No approved leave falls within this period." />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend}>
                        <defs>
                          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeOpacity={0.15} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                        <YAxis tickLine={false} axisLine={false} fontSize={12} width={28} allowDecimals={false} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          cursor={{ stroke: "var(--border)" }}
                          formatter={(value, name) => [value, name === "days" ? "Days taken" : "Requests"]}
                        />
                        <Area type="monotone" dataKey="days" stroke="var(--color-chart-1)" fill="url(#trendFill)" strokeWidth={2} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChartIcon className="size-4" /> Leave type mix
                  </CardTitle>
                  <CardDescription>Share of approved days by type.</CardDescription>
                </CardHeader>
                <CardContent className="h-64">
                  {leaveTypeMix.length === 0 ? (
                    <EmptyState icon={PieChartIcon} title="No data" description="No approved leave in this period." />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={leaveTypeMix}
                          dataKey="days"
                          nameKey="leaveType.name"
                          innerRadius="55%"
                          outerRadius="85%"
                          paddingAngle={2}
                          isAnimationActive={false}
                          onClick={(entry) => setLeaveTypeId((entry as unknown as { leaveType: { id: string } }).leaveType.id)}
                          className="cursor-pointer"
                        >
                          {leaveTypeMix.map((slice) => (
                            <Cell key={slice.leaveType.id} fill={slice.leaveType.color} stroke="var(--card)" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value, _name, entry) => [`${value} days (${entry.payload.percentage}%)`, entry.payload.leaveType.name]} />
                        <Legend
                          verticalAlign="bottom"
                          height={24}
                          formatter={(_value, entry) => (entry.payload as unknown as { leaveType: { name: string } }).leaveType.name}
                          wrapperStyle={{ fontSize: 11 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Department breakdown + drill-down */}
            {showDeptChart ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BuildingIcon className="size-4" /> Leave by department
                  </CardTitle>
                  <CardDescription>Approved days taken per department. Click a bar to see who took leave.</CardDescription>
                </CardHeader>
                <CardContent className="h-64">
                  {byDepartment.every((d) => d.daysTaken === 0) ? (
                    <EmptyState icon={BuildingIcon} title="No data" description="No approved leave in this period." />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={byDepartment} barSize={36}>
                        <CartesianGrid vertical={false} strokeOpacity={0.15} />
                        <XAxis dataKey="department.name" tickLine={false} axisLine={false} fontSize={12} />
                        <YAxis tickLine={false} axisLine={false} fontSize={12} width={28} allowDecimals={false} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          cursor={{ fill: "var(--muted)" }}
                          formatter={(value, _name, entry) => [`${value} days (${entry.payload.requestCount} requests)`, "Taken"]}
                        />
                        <Bar
                          dataKey="daysTaken"
                          radius={[4, 4, 0, 0]}
                          isAnimationActive={false}
                          className="cursor-pointer"
                          onClick={(entry) => setDrilldownDeptId((entry as unknown as { department: { id: string } }).department.id)}
                        >
                          {byDepartment.map((d) => (
                            <Cell key={d.department.id} fill={d.department.id === drilldownDeptId ? "var(--color-chart-4)" : "var(--color-chart-1)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {(drilldownDeptId || !showDeptChart) && (
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>{activeDrilldownDept?.name ?? data.departments.find((d) => d.id === departmentId)?.name}</CardTitle>
                    <CardDescription>Approved leave by employee in this period.</CardDescription>
                  </div>
                  {showDeptChart && drilldownDeptId && (
                    <Button variant="ghost" size="sm" onClick={() => setDrilldownDeptId(null)}>
                      <XIcon /> Clear
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {(showDeptChart ? drilldown : computeDeptDrilldownFallback(data, departmentId)).length === 0 ? (
                    <EmptyState icon={BuildingIcon} title="No leave taken" description="No approved leave for this department in the selected period." />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Requests</TableHead>
                          <TableHead>Days taken</TableHead>
                          <TableHead>Most-used type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(showDeptChart ? drilldown : computeDeptDrilldownFallback(data, departmentId)).map((row) => (
                          <TableRow key={row.employee.id}>
                            <TableCell className="font-medium">
                              <span className="flex items-center gap-2">
                                <Avatar className="size-6">
                                  <AvatarFallback className="text-[10px]">{initials(row.employee.name)}</AvatarFallback>
                                </Avatar>
                                {row.employee.name}
                              </span>
                            </TableCell>
                            <TableCell>{row.requestCount}</TableCell>
                            <TableCell>{row.daysTaken}</TableCell>
                            <TableCell className="text-muted-foreground">{row.topLeaveType ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Raw activity, for context */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileTextIcon className="size-4" /> Requests in this period
                </CardTitle>
                <CardDescription>{data.requests.length} request{data.requests.length === 1 ? "" : "s"} matching the selected filters.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.requests.length === 0 ? (
                  <EmptyState icon={FileTextIcon} title="Nothing here" description="No leave requests match the selected filters." />
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Leave type</TableHead>
                          <TableHead>Dates</TableHead>
                          <TableHead>Days</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.requests.slice(0, 100).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.employee.name}</TableCell>
                            <TableCell>
                              <span className="flex items-center gap-1.5">
                                <LeaveTypeDot color={r.leaveType.color} /> {r.leaveType.name}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {format(parseISO(r.startDate), "d MMM yyyy")} – {format(parseISO(r.endDate), "d MMM yyyy")}
                            </TableCell>
                            <TableCell>{r.days}</TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={cn(
                                  r.status === "APPROVED" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400",
                                  r.status === "PENDING" && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
                                  r.status === "REJECTED" && "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400"
                                )}
                              >
                                {r.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function computeDeptDrilldownFallback(data: ReportsData, departmentId: string) {
  const approved = data.requests.filter((r) => r.status === "APPROVED" && r.employee.departmentId === departmentId);
  const byEmployee = new Map<string, { employee: LeaveRequestWithRelations["employee"]; days: number; requests: number; types: Map<string, number> }>();
  for (const r of approved) {
    const entry = byEmployee.get(r.employeeId) ?? { employee: r.employee, days: 0, requests: 0, types: new Map<string, number>() };
    entry.days += r.days;
    entry.requests += 1;
    entry.types.set(r.leaveType.name, (entry.types.get(r.leaveType.name) ?? 0) + r.days);
    byEmployee.set(r.employeeId, entry);
  }
  return Array.from(byEmployee.values())
    .map((e) => ({
      employee: e.employee,
      daysTaken: e.days,
      requestCount: e.requests,
      topLeaveType: Array.from(e.types.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.daysTaken - a.daysTaken);
}
