import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { loadSnapshot } from "@/lib/db/repo";
import type { TeamCalendarData, TeamCalendarEntry } from "@/types";

function parseMonth(value: string | null): { year: number; month: number } {
  const now = new Date();
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    return { year: y, month: m - 1 };
  }
  return { year: now.getFullYear(), month: now.getMonth() };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const { year, month } = parseMonth(request.nextUrl.searchParams.get("month"));
  const scopeParam = request.nextUrl.searchParams.get("scope") === "company" && user.role === "ADMIN" ? "company" : "team";

  const monthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);

  const snapshot = await loadSnapshot();
  const inScopeEmployeeIds =
    scopeParam === "company"
      ? new Set(snapshot.employees.map((e) => e.id))
      : new Set(snapshot.employees.filter((e) => e.departmentId === user.departmentId).map((e) => e.id));

  const entries: TeamCalendarEntry[] = snapshot.leaveRequests
    .filter((r) => r.status === "APPROVED" && inScopeEmployeeIds.has(r.employeeId) && r.startDate <= monthEnd && r.endDate >= monthStart)
    .map((r) => {
      const employee = snapshot.employees.find((e) => e.id === r.employeeId)!;
      const leaveType = snapshot.leaveTypes.find((t) => t.id === r.leaveTypeId)!;
      return {
        employee: { id: employee.id, name: employee.name, avatarUrl: employee.avatarUrl },
        leaveType: { id: leaveType.id, name: leaveType.name, color: leaveType.color, code: leaveType.code },
        startDate: r.startDate,
        endDate: r.endDate,
      };
    });

  const holidays = snapshot.holidays.filter((h) => h.date >= monthStart && h.date <= monthEnd);
  const department = snapshot.departments.find((d) => d.id === user.departmentId) ?? null;

  const data: TeamCalendarData = {
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    entries,
    holidays,
    scope: scopeParam,
    departmentName: scopeParam === "team" ? (department?.name ?? null) : null,
  };
  return NextResponse.json(data);
}
