import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { hydrateLeaveRequest, loadSnapshot } from "@/lib/db/repo";
import { CURRENT_YEAR } from "@/lib/mock-data/seed";
import type { LeaveRequest, ReportsData } from "@/types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000) + 1;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can view reports.");

  const params = request.nextUrl.searchParams;
  const from = params.get("from") || `${CURRENT_YEAR}-01-01`;
  const to = params.get("to") || todayISO();
  const departmentId = params.get("departmentId") || null;
  const leaveTypeId = params.get("leaveTypeId") || null;

  if (from > to) return errorResponse(400, "'from' must be on or before 'to'.");

  const spanDays = daysBetweenInclusive(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(spanDays - 1));

  const snapshot = await loadSnapshot();
  const employeeById = new Map(snapshot.employees.map((e) => [e.id, e]));

  const overlaps = (r: LeaveRequest, rangeFrom: string, rangeTo: string) => r.startDate <= rangeTo && r.endDate >= rangeFrom;

  const matchesFilters = (r: LeaveRequest) => {
    if (leaveTypeId && r.leaveTypeId !== leaveTypeId) return false;
    if (departmentId) {
      const emp = employeeById.get(r.employeeId);
      if (!emp || emp.departmentId !== departmentId) return false;
    }
    return true;
  };

  const requests = snapshot.leaveRequests
    .filter((r) => matchesFilters(r) && overlaps(r, from, to))
    .map((r) => hydrateLeaveRequest(snapshot, r))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const previousRequests = snapshot.leaveRequests.filter((r) => matchesFilters(r) && overlaps(r, prevFrom, prevTo)).map((r) => hydrateLeaveRequest(snapshot, r));

  const data: ReportsData = {
    filters: { from, to, departmentId, leaveTypeId },
    departments: snapshot.departments,
    leaveTypes: snapshot.leaveTypes.filter((t) => t.isActive),
    requests,
    previousRequests,
  };

  return NextResponse.json(data);
}
