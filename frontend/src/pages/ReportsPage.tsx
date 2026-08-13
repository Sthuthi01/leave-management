import { useMemo, useState } from "react";
import { Button, Card, Col, DatePicker, Row, Select, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import { BulbOutlined, CloseOutlined, DownloadOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { Area, Column, Pie } from "@ant-design/charts";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../lib/api-client";
import { formatDaysForDisplay } from "../lib/format";
import type { LeaveStatus, ReportLeaveRequest, ReportsData } from "../types";

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <QuestionCircleOutlined style={{ marginLeft: 4, color: "rgba(0,0,0,0.45)" }} />
    </Tooltip>
  );
}

const STATUS_COLORS: Record<LeaveStatus, string> = {
  PENDING: "gold",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "default",
};

type PeriodPreset = "last30" | "last3m" | "last6m" | "ytd" | "custom";

function presetRange(preset: PeriodPreset): [Dayjs, Dayjs] {
  const today = dayjs();
  switch (preset) {
    case "last30":
      return [today.subtract(29, "day"), today];
    case "last3m":
      return [today.subtract(3, "month").add(1, "day"), today];
    case "last6m":
      return [today.subtract(6, "month").add(1, "day"), today];
    case "custom":
      return [today.subtract(29, "day"), today];
    case "ytd":
    default:
      return [today.startOf("year"), today];
  }
}

function computeKpis(requests: ReportLeaveRequest[]) {
  const active = requests.filter((r) => r.status !== "CANCELLED");
  const approved = requests.filter((r) => r.status === "APPROVED");
  const decided = requests.filter((r) => r.status === "APPROVED" || r.status === "REJECTED");

  const totalDaysTaken = approved.reduce((sum, r) => sum + r.days, 0);
  const totalRequests = active.length;
  const approvalRate =
    decided.length > 0 ? Math.round((decided.filter((r) => r.status === "APPROVED").length / decided.length) * 100) : null;
  const avgTurnaroundDays =
    decided.length > 0
      ? decided.reduce((sum, r) => {
          if (!r.decided_at) return sum;
          return sum + (dayjs(r.decided_at).valueOf() - dayjs(r.applied_at).valueOf()) / 86_400_000;
        }, 0) / decided.length
      : null;

  return { totalDaysTaken, totalRequests, approvalRate, avgTurnaroundDays };
}

function formatDelta(current: number | null, previous: number | null, invert = false): { text: string; color: string } | null {
  if (current === null || previous === null) return null;
  if (previous === 0) {
    if (current === 0) return { text: "No change", color: "#8c8c8c" };
    return { text: "Up from 0", color: invert ? "#cf1322" : "#3f8600" };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "No change", color: "#8c8c8c" };
  const good = invert ? pct < 0 : pct > 0;
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, color: good ? "#3f8600" : "#cf1322" };
}

function bucketTrend(requests: ReportLeaveRequest[], from: Dayjs, to: Dayjs) {
  const spanDays = to.diff(from, "day") + 1;
  const granularity: "day" | "week" | "month" = spanDays <= 14 ? "day" : spanDays <= 90 ? "week" : "month";
  const buckets = new Map<string, number>();

  const bucketKey = (d: Dayjs) => {
    if (granularity === "day") return d.format("YYYY-MM-DD");
    if (granularity === "week") return d.startOf("week").format("YYYY-MM-DD");
    return d.format("YYYY-MM");
  };

  for (const request of requests) {
    if (request.status !== "APPROVED") continue;
    const key = bucketKey(dayjs(request.start_date));
    buckets.set(key, (buckets.get(key) ?? 0) + request.days);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, days]) => ({ date, days }));
}

function downloadCsv(rows: ReportLeaveRequest[], from: string, to: string) {
  const headers = [
    "Reference", "Employee", "Department", "Leave type", "Start date", "End date", "Days", "Status",
    "Applied at", "Decided at", "Approver",
  ];
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.reference_number, r.employee.name, r.employee.department.name, r.leave_type.name, r.start_date, r.end_date,
        String(r.days), r.status, r.applied_at, r.decided_at ?? "", r.approver?.name ?? "",
      ]
        .map((v) => escape(String(v)))
        .join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leave-report_${from}_to_${to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [preset, setPreset] = useState<PeriodPreset>("ytd");
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs]>(presetRange("ytd"));
  const [departmentId, setDepartmentId] = useState<number | "all">("all");
  const [leaveTypeId, setLeaveTypeId] = useState<number | "all">("all");
  const [drilldownDeptId, setDrilldownDeptId] = useState<number | null>(null);

  const [from, to] = preset === "custom" ? customRange : presetRange(preset);
  const fromStr = from.format("YYYY-MM-DD");
  const toStr = to.format("YYYY-MM-DD");

  const params = new URLSearchParams({ from: fromStr, to: toStr });
  if (departmentId !== "all") params.set("department_id", String(departmentId));
  if (leaveTypeId !== "all") params.set("leave_type_id", String(leaveTypeId));

  const reports = useQuery({
    queryKey: ["reports", fromStr, toStr, departmentId, leaveTypeId],
    queryFn: () => api.get<ReportsData>(`/reports/?${params.toString()}`),
  });

  const data = reports.data;
  const kpis = useMemo(() => computeKpis(data?.requests ?? []), [data]);
  const previousKpis = useMemo(() => computeKpis(data?.previous_requests ?? []), [data]);
  const trend = useMemo(() => bucketTrend(data?.requests ?? [], from, to), [data, from, to]);

  const leaveTypeMix = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of data?.requests ?? []) {
      if (r.status !== "APPROVED") continue;
      totals.set(r.leave_type.name, (totals.get(r.leave_type.name) ?? 0) + r.days);
    }
    return [...totals.entries()].map(([type, value]) => ({ type, value }));
  }, [data]);

  const byDepartment = useMemo(() => {
    const totals = new Map<number, { id: number; name: string; days: number; requests: number }>();
    for (const r of data?.requests ?? []) {
      if (r.status === "CANCELLED") continue;
      const entry = totals.get(r.employee.department.id) ?? { id: r.employee.department.id, name: r.employee.department.name, days: 0, requests: 0 };
      entry.requests += 1;
      if (r.status === "APPROVED") entry.days += r.days;
      totals.set(r.employee.department.id, entry);
    }
    return [...totals.values()].sort((a, b) => b.days - a.days);
  }, [data]);

  const departmentDays = useMemo(() => byDepartment.map((d) => ({ department: d.name, days: d.days })), [byDepartment]);

  const leaveTypeMixWithShare = useMemo(() => {
    const total = leaveTypeMix.reduce((sum, t) => sum + t.value, 0);
    return leaveTypeMix
      .map((t) => ({ ...t, percentage: total > 0 ? Math.round((t.value / total) * 100) : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [leaveTypeMix]);

  const insights = useMemo(() => {
    if (!data) return [];
    const list: string[] = [];
    const totalDays = byDepartment.reduce((s, d) => s + d.days, 0);

    if (departmentId === "all" && byDepartment.length > 0 && byDepartment[0].days > 0) {
      const top = byDepartment[0];
      const pct = totalDays > 0 ? Math.round((top.days / totalDays) * 100) : 0;
      list.push(
        `${top.name} led leave usage this period with ${top.days} day${top.days === 1 ? "" : "s"} across ${top.requests} request${top.requests === 1 ? "" : "s"} (${pct}% of company-wide days).`
      );
      const zero = byDepartment.filter((d) => d.requests === 0);
      if (zero.length > 0 && zero.length < byDepartment.length) {
        list.push(`No leave activity recorded for ${zero.map((d) => d.name).join(", ")} this period.`);
      }
    }

    if (leaveTypeMixWithShare.length > 0) {
      const top = leaveTypeMixWithShare[0];
      list.push(`${top.type} was the most-used leave type, accounting for ${top.percentage}% of approved leave days.`);
    }

    const daysDelta = formatDelta(kpis.totalDaysTaken, previousKpis.totalDaysTaken);
    if (daysDelta && daysDelta.text !== "No change" && previousKpis.totalDaysTaken > 0) {
      list.push(`Leave days taken were ${daysDelta.text} compared with the previous period.`);
    }

    if (kpis.avgTurnaroundDays !== null && previousKpis.avgTurnaroundDays !== null && previousKpis.avgTurnaroundDays > 0) {
      const deltaDays = kpis.avgTurnaroundDays - previousKpis.avgTurnaroundDays;
      if (Math.abs(deltaDays) >= 0.2) {
        const curr = formatDaysForDisplay(kpis.avgTurnaroundDays);
        const prev = formatDaysForDisplay(previousKpis.avgTurnaroundDays);
        list.push(`Average approval turnaround ${deltaDays < 0 ? "improved" : "slowed"} to ${curr} day${curr === "1" ? "" : "s"}, from ${prev}.`);
      }
    }

    return list.slice(0, 4);
  }, [data, byDepartment, leaveTypeMixWithShare, kpis, previousKpis, departmentId]);

  const drilldownRequests = useMemo(() => {
    if (drilldownDeptId === null) return [];
    return (data?.requests ?? []).filter((r) => r.employee.department.id === drilldownDeptId);
  }, [data, drilldownDeptId]);

  const drilldownDeptName = drilldownDeptId !== null ? byDepartment.find((d) => d.id === drilldownDeptId)?.name : undefined;

  const isFiltered = departmentId !== "all" || leaveTypeId !== "all" || preset !== "ytd";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Reports
        </Typography.Title>
        <Button
          icon={<DownloadOutlined />}
          disabled={!data?.requests.length}
          onClick={() => data && downloadCsv(data.requests, fromStr, toStr)}
        >
          Export CSV
        </Button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        <Select
          value={preset}
          onChange={setPreset}
          style={{ width: 160 }}
          options={[
            { value: "last30", label: "Last 30 days" },
            { value: "last3m", label: "Last 3 months" },
            { value: "last6m", label: "Last 6 months" },
            { value: "ytd", label: "Year to date" },
            { value: "custom", label: "Custom" },
          ]}
        />
        {preset === "custom" && (
          <DatePicker.RangePicker
            value={customRange}
            onChange={(range) => range?.[0] && range?.[1] && setCustomRange([range[0], range[1]])}
          />
        )}
        <Select
          value={departmentId}
          onChange={(v) => {
            setDepartmentId(v);
            setDrilldownDeptId(null);
          }}
          style={{ width: 180 }}
          options={[
            { value: "all", label: "All departments" },
            ...(data?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
        <Select
          value={leaveTypeId}
          onChange={setLeaveTypeId}
          style={{ width: 180 }}
          options={[
            { value: "all", label: "All leave types" },
            ...(data?.leave_types ?? []).map((lt) => ({ value: lt.id, label: lt.name })),
          ]}
        />
        {isFiltered && (
          <Button
            onClick={() => {
              setPreset("ytd");
              setDepartmentId("all");
              setLeaveTypeId("all");
              setDrilldownDeptId(null);
            }}
          >
            Reset
          </Button>
        )}
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        {[
          { title: "Leave days taken", value: kpis.totalDaysTaken, delta: formatDelta(kpis.totalDaysTaken, previousKpis.totalDaysTaken) },
          { title: "Requests submitted", value: kpis.totalRequests, delta: formatDelta(kpis.totalRequests, previousKpis.totalRequests) },
          {
            title: "Approval rate",
            value: kpis.approvalRate === null ? "—" : `${kpis.approvalRate}%`,
            delta: formatDelta(kpis.approvalRate, previousKpis.approvalRate),
            tooltip: "Share of decided requests that were approved (excludes pending).",
          },
          {
            title: "Avg. approval time",
            value: kpis.avgTurnaroundDays === null ? "—" : `${formatDaysForDisplay(kpis.avgTurnaroundDays)}d`,
            delta: formatDelta(kpis.avgTurnaroundDays, previousKpis.avgTurnaroundDays, true),
            tooltip: "Average days between submission and a manager's decision.",
          },
        ].map((kpi) => (
          <Col key={kpi.title} xs={24} sm={12} md={6}>
            <Card size="small" loading={reports.isLoading}>
              <Statistic
                title={
                  <span>
                    {kpi.title}
                    {kpi.tooltip && <InfoTooltip text={kpi.tooltip} />}
                  </span>
                }
                value={kpi.value}
              />
              {kpi.delta && (
                <Typography.Text style={{ color: kpi.delta.color, fontSize: 12 }}>{kpi.delta.text} vs. prior period</Typography.Text>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      {insights.length > 0 && (
        <Card size="small" style={{ marginBottom: 24 }}>
          <Typography.Text strong style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <BulbOutlined style={{ color: "#1677ff" }} /> Insights
          </Typography.Text>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {insights.map((text, i) => (
              <li key={i} style={{ fontSize: 13, color: "rgba(0,0,0,0.65)", marginBottom: 4 }}>
                {text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12} style={{ marginBottom: 16 }}>
          <Card title="Leave days over time" size="small" loading={reports.isLoading}>
            {trend.length > 0 ? (
              <Area
                data={trend}
                xField="date"
                yField="days"
                height={220}
                style={{ fill: "linear-gradient(-90deg, white 0%, #16a34a 100%)" }}
              />
            ) : (
              <Typography.Text type="secondary">No approved leave in this period.</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12} style={{ marginBottom: 16 }}>
          <Card title="Leave type mix" size="small" loading={reports.isLoading}>
            {leaveTypeMix.length > 0 ? (
              <Pie
                data={leaveTypeMix}
                angleField="value"
                colorField="type"
                innerRadius={0.6}
                height={220}
                onReady={(plot) => {
                  plot.chart.on("element:click", (event: { data?: { data?: { type?: string } } }) => {
                    const clickedType = event.data?.data?.type;
                    const match = (data?.leave_types ?? []).find((lt) => lt.name === clickedType);
                    if (match) setLeaveTypeId(match.id);
                  });
                }}
              />
            ) : (
              <Typography.Text type="secondary">No approved leave in this period.</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      {departmentId === "all" ? (
        <Card title="Leave by department" size="small" style={{ marginBottom: 24 }} loading={reports.isLoading}>
          {departmentDays.length > 0 ? (
            <Column
              data={departmentDays}
              xField="department"
              yField="days"
              height={240}
              onReady={(plot) => {
                plot.chart.on("element:click", (event: { data?: { data?: { department?: string } } }) => {
                  const clickedDept = event.data?.data?.department;
                  const match = byDepartment.find((d) => d.name === clickedDept);
                  if (match) setDrilldownDeptId(match.id);
                });
              }}
            />
          ) : (
            <Typography.Text type="secondary">No approved leave in this period.</Typography.Text>
          )}
        </Card>
      ) : (
        <Card title="Leave by employee" size="small" style={{ marginBottom: 24 }} loading={reports.isLoading}>
          <EmployeeDrilldown requests={data?.requests ?? []} />
        </Card>
      )}

      {departmentId === "all" && drilldownDeptId !== null && (
        <Card
          size="small"
          style={{ marginBottom: 24 }}
          title={drilldownDeptName ?? "Department"}
          extra={
            <Button size="small" icon={<CloseOutlined />} onClick={() => setDrilldownDeptId(null)}>
              Clear
            </Button>
          }
        >
          <EmployeeDrilldown requests={drilldownRequests} />
        </Card>
      )}

      <Card title={`Requests (${data?.requests.length ?? 0})`} size="small">
        <Table<ReportLeaveRequest>
          rowKey="id"
          size="small"
          loading={reports.isLoading}
          dataSource={(data?.requests ?? []).slice(0, 100)}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: "Reference", dataIndex: "reference_number" },
            { title: "Employee", render: (_, r) => r.employee.name },
            { title: "Department", render: (_, r) => r.employee.department.name },
            { title: "Leave Type", render: (_, r) => r.leave_type.name },
            { title: "Dates", render: (_, r) => `${r.start_date} – ${r.end_date}` },
            { title: "Days", dataIndex: "days", align: "right" },
            { title: "Status", dataIndex: "status", render: (v: LeaveStatus) => <Tag color={STATUS_COLORS[v]}>{v}</Tag> },
          ]}
        />
      </Card>
    </>
  );
}

function EmployeeDrilldown({ requests }: { requests: ReportLeaveRequest[] }) {
  const byEmployee = useMemo(() => {
    const map = new Map<number, { name: string; days: number; requests: number; leaveTypes: Map<string, number> }>();
    for (const r of requests) {
      if (r.status !== "APPROVED") continue;
      const entry = map.get(r.employee.id) ?? { name: r.employee.name, days: 0, requests: 0, leaveTypes: new Map() };
      entry.days += r.days;
      entry.requests += 1;
      entry.leaveTypes.set(r.leave_type.name, (entry.leaveTypes.get(r.leave_type.name) ?? 0) + r.days);
      map.set(r.employee.id, entry);
    }
    return [...map.entries()].map(([id, v]) => ({
      id,
      name: v.name,
      days: v.days,
      requests: v.requests,
      topLeaveType: [...v.leaveTypes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—",
    }));
  }, [requests]);

  return (
    <Table
      rowKey="id"
      size="small"
      dataSource={byEmployee}
      pagination={false}
      locale={{ emptyText: "No approved leave in this period." }}
      columns={[
        { title: "Employee", dataIndex: "name" },
        { title: "Days", dataIndex: "days", align: "right" },
        { title: "Requests", dataIndex: "requests", align: "right" },
        { title: "Top leave type", dataIndex: "topLeaveType" },
      ]}
    />
  );
}
