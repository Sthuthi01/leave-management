import { useMemo, useState } from "react";
import { Button, Segmented, Tag, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../lib/api-client";
import { useCurrentUser } from "../hooks/useCurrentUser";
import type { TeamCalendarData, TeamCalendarEntry, TeamCalendarScope } from "../types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_ENTRIES_PER_DAY = 3;

function buildGridDays(monthStart: Dayjs): Dayjs[] {
  const gridStart = monthStart.startOf("week");
  const monthEnd = monthStart.endOf("month");
  const gridEnd = monthEnd.endOf("week");
  const days: Dayjs[] = [];
  let cursor = gridStart;
  while (cursor.isBefore(gridEnd) || cursor.isSame(gridEnd, "day")) {
    days.push(cursor);
    cursor = cursor.add(1, "day");
  }
  return days;
}

export function TeamCalendarPage() {
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";
  const [month, setMonth] = useState(() => dayjs().startOf("month"));
  const [scope, setScope] = useState<TeamCalendarScope>("team");

  const monthParam = month.format("YYYY-MM");
  const effectiveScope = isAdmin ? scope : "team";

  const calendar = useQuery({
    queryKey: ["team-calendar", monthParam, effectiveScope],
    queryFn: () => api.get<TeamCalendarData>(`/team-calendar/?month=${monthParam}&scope=${effectiveScope}`),
  });

  const gridDays = useMemo(() => buildGridDays(month), [month]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, TeamCalendarEntry[]>();
    if (!calendar.data) return map;
    for (const entry of calendar.data.entries) {
      let cursor = dayjs(entry.start_date);
      const end = dayjs(entry.end_date);
      while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
        const key = cursor.format("YYYY-MM-DD");
        const existing = map.get(key) ?? [];
        existing.push(entry);
        map.set(key, existing);
        cursor = cursor.add(1, "day");
      }
    }
    return map;
  }, [calendar.data]);

  const holidaysByDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const holiday of calendar.data?.holidays ?? []) {
      map.set(holiday.date, holiday.name);
    }
    return map;
  }, [calendar.data]);

  const legend = useMemo(() => {
    const seen = new Map<number, TeamCalendarEntry["leave_type"]>();
    for (const entry of calendar.data?.entries ?? []) {
      seen.set(entry.leave_type.id, entry.leave_type);
    }
    return [...seen.values()];
  }, [calendar.data]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Team Calendar
          {calendar.data?.scope === "team" && calendar.data.department_name
            ? ` — ${calendar.data.department_name}`
            : calendar.data?.scope === "company"
              ? " — Company"
              : ""}
        </Typography.Title>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isAdmin && (
            <Segmented
              value={scope}
              onChange={(value) => setScope(value as TeamCalendarScope)}
              options={[
                { label: "My Team", value: "team" },
                { label: "Company", value: "company" },
              ]}
            />
          )}
          <Button icon={<LeftOutlined />} onClick={() => setMonth(month.subtract(1, "month"))} />
          <Button onClick={() => setMonth(dayjs().startOf("month"))}>Today</Button>
          <Button icon={<RightOutlined />} onClick={() => setMonth(month.add(1, "month"))} />
          <Typography.Text strong>{month.format("MMMM YYYY")}</Typography.Text>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", border: "1px solid #f0f0f0" }}>
        {DAY_LABELS.map((label) => (
          <div key={label} style={{ padding: 8, textAlign: "center", fontWeight: 600, background: "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
            {label}
          </div>
        ))}
        {gridDays.map((day) => {
          const key = day.format("YYYY-MM-DD");
          const dayEntries = entriesByDay.get(key) ?? [];
          const holidayName = holidaysByDay.get(key);
          const inCurrentMonth = day.isSame(month, "month");
          const shown = dayEntries.slice(0, MAX_ENTRIES_PER_DAY);
          const overflow = dayEntries.length - shown.length;
          return (
            <div
              key={key}
              style={{
                minHeight: 96,
                padding: 6,
                borderRight: "1px solid #f0f0f0",
                borderBottom: "1px solid #f0f0f0",
                background: inCurrentMonth ? "#fff" : "#fafafa",
                opacity: inCurrentMonth ? 1 : 0.5,
              }}
            >
              <Typography.Text type={day.isSame(dayjs(), "day") ? undefined : "secondary"} strong={day.isSame(dayjs(), "day")}>
                {day.format("D")}
              </Typography.Text>
              {holidayName && (
                <div style={{ fontSize: 11, color: "#d97706", marginTop: 2 }} title={holidayName}>
                  🎉 {holidayName}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                {shown.map((entry, idx) => (
                  <Tag
                    key={`${entry.employee.id}-${idx}`}
                    color={entry.leave_type.color}
                    style={{ margin: 0, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {entry.employee.name}
                  </Tag>
                ))}
                {overflow > 0 && (
                  <Typography.Text style={{ fontSize: 11 }} type="secondary">
                    +{overflow} more
                  </Typography.Text>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {legend.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {legend.map((leaveType) => (
            <Tag key={leaveType.id} color={leaveType.color}>
              {leaveType.name}
            </Tag>
          ))}
        </div>
      )}
    </>
  );
}
