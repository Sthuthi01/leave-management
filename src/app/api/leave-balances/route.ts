import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { accruedToDate, getOrCreateBalance, loadSnapshot } from "@/lib/db/repo";
import { CURRENT_YEAR } from "@/lib/mock-data/seed";
import type { LeaveBalanceSummary } from "@/types";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const snapshot = await loadSnapshot();
  const requestedEmployeeId = request.nextUrl.searchParams.get("employeeId");
  const employeeId = requestedEmployeeId && user.role === "ADMIN" ? requestedEmployeeId : user.id;
  const year = Number(request.nextUrl.searchParams.get("year")) || CURRENT_YEAR;

  const employee = snapshot.employees.find((e) => e.id === employeeId);
  if (!employee) return errorResponse(404, "Employee not found.");

  const summaries: LeaveBalanceSummary[] = [];
  for (const leaveType of snapshot.leaveTypes.filter((t) => t.isActive)) {
    const bal = await getOrCreateBalance(snapshot, employeeId, leaveType.id, year);
    const accrued = accruedToDate(employee, leaveType, bal);
    summaries.push({ leaveType, year, allocated: bal.allocated, used: bal.used, remaining: accrued - bal.used, accruedToDate: accrued, carriedForward: bal.carriedForward });
  }

  return NextResponse.json(summaries);
}
