import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { accruedToDate, getOrCreateBalance, hydrateLeaveRequest, loadSnapshot } from "@/lib/db/repo";
import { CURRENT_YEAR } from "@/lib/mock-data/seed";
import type { AttentionPendingApproval, DashboardData, DepartmentStat, LeaveBalanceSummary, LeaveTypeUtilization } from "@/types";

// A pending request starting this soon is flagged regardless of how long it's been waiting —
// separate from AppSettings.pendingApprovalUrgencyDays, which governs "waited too long" instead.
const STARTING_SOON_DAYS = 2;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetweenDates(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86_400_000);
}

function isOnLeave(startDate: string, endDate: string, onDate: string) {
  return startDate <= onDate && onDate <= endDate;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const snapshot = await loadSnapshot();
  const today = todayISO();
  const upcomingHolidays = [...snapshot.holidays].filter((h) => h.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  if (user.role !== "ADMIN") {
    const myRequests = snapshot.leaveRequests.filter((r) => r.employeeId === user.id);
    const balances: LeaveBalanceSummary[] = [];
    for (const leaveType of snapshot.leaveTypes.filter((t) => t.isActive)) {
      const bal = await getOrCreateBalance(snapshot, user.id, leaveType.id, CURRENT_YEAR);
      const accrued = accruedToDate(user, leaveType, bal);
      balances.push({ leaveType, year: CURRENT_YEAR, allocated: bal.allocated, used: bal.used, remaining: accrued - bal.used, accruedToDate: accrued, carriedForward: bal.carriedForward });
    }

    const data: DashboardData = {
      kind: "EMPLOYEE",
      balances,
      recentRequests: myRequests
        .map((r) => hydrateLeaveRequest(snapshot, r))
        .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
        .slice(0, 5),
      upcomingLeave: myRequests
        .filter((r) => r.status === "APPROVED" && r.endDate >= today)
        .map((r) => hydrateLeaveRequest(snapshot, r))
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
      upcomingHolidays,
      pendingApprovalsCount: snapshot.leaveRequests.filter((r) => r.approverId === user.id && r.status === "PENDING").length,
    };
    return NextResponse.json(data);
  }

  const onLeaveToday = snapshot.leaveRequests
    .filter((r) => r.status === "APPROVED" && isOnLeave(r.startDate, r.endDate, today))
    .map((r) => hydrateLeaveRequest(snapshot, r));

  const weekEnd = addDays(today, 6);
  const onLeaveThisWeek = snapshot.leaveRequests.filter((r) => r.status === "APPROVED" && r.startDate <= weekEnd && r.endDate >= today).length;

  const leaveUtilization: LeaveTypeUtilization[] = snapshot.leaveTypes
    .filter((t) => t.isActive)
    .map((leaveType) => {
      const rows = snapshot.leaveBalances.filter((b) => b.leaveTypeId === leaveType.id && b.year === CURRENT_YEAR);
      return {
        leaveType,
        allocated: rows.reduce((sum, r) => sum + r.allocated, 0),
        used: rows.reduce((sum, r) => sum + r.used, 0),
      };
    });

  const activeEmployees = snapshot.employees.filter((e) => e.status === "ACTIVE");
  const departmentStats: DepartmentStat[] = snapshot.departments.map((department) => {
    const deptEmployees = activeEmployees.filter((e) => e.departmentId === department.id);
    const deptEmployeeIds = new Set(deptEmployees.map((e) => e.id));
    return {
      department,
      employeeCount: deptEmployees.length,
      onLeaveToday: onLeaveToday.filter((r) => deptEmployeeIds.has(r.employeeId)).length,
    };
  });

  const attentionPendingApprovals: AttentionPendingApproval[] = snapshot.leaveRequests
    .filter((r) => r.status === "PENDING")
    .map((r) => ({
      request: hydrateLeaveRequest(snapshot, r),
      daysPending: Math.floor((Date.now() - new Date(r.appliedAt).getTime()) / 86_400_000),
      daysUntilStart: daysBetweenDates(today, r.startDate),
    }))
    .filter((x) => x.daysPending >= snapshot.settings.pendingApprovalUrgencyDays || x.daysUntilStart <= STARTING_SOON_DAYS)
    .sort((a, b) => a.daysUntilStart - b.daysUntilStart || b.daysPending - a.daysPending)
    .slice(0, 6);

  const employeesWithoutManager = activeEmployees
    .filter((e) => e.role !== "ADMIN" && !e.managerId)
    .map((e) => ({ id: e.id, name: e.name, title: e.title }));

  const data: DashboardData = {
    kind: "HR",
    totalEmployees: activeEmployees.length,
    onLeaveToday,
    onLeaveThisWeek,
    pendingApprovalsCount: snapshot.leaveRequests.filter((r) => r.status === "PENDING").length,
    attentionPendingApprovals,
    employeesWithoutManager,
    leaveUtilization,
    departmentStats,
    upcomingHolidays,
    recentRequests: [...snapshot.leaveRequests]
      .map((r) => hydrateLeaveRequest(snapshot, r))
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
      .slice(0, 8),
  };
  return NextResponse.json(data);
}
