import { randomUUID } from "crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, ensureReady } from "./client";
import * as schema from "./schema";
import { CURRENT_YEAR } from "@/lib/mock-data/seed";
import type {
  AppSettings,
  AuditLogEntry,
  Department,
  Employee,
  EmployeeRecord,
  EmployeeWithRelations,
  Holiday,
  LeaveBalance,
  LeaveRequest,
  LeaveRequestWithRelations,
  LeaveStatus,
  LeaveType,
} from "@/types";

export interface Snapshot {
  departments: Department[];
  employees: EmployeeRecord[];
  leaveTypes: LeaveType[];
  holidays: Holiday[];
  leaveBalances: LeaveBalance[];
  leaveRequests: LeaveRequest[];
  settings: AppSettings;
}

function rowToLeaveRequest(row: typeof schema.leaveRequests.$inferSelect): LeaveRequest {
  return { ...row, appliedAt: row.appliedAt.toISOString(), decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null };
}

function rowToSettings(row: typeof schema.appSettings.$inferSelect): AppSettings {
  return {
    workingDays: row.workingDays,
    upcomingLeaveWindowDays: row.upcomingLeaveWindowDays,
    pendingApprovalUrgencyDays: row.pendingApprovalUrgencyDays,
    auditLogDisplayLimit: row.auditLogDisplayLimit,
    sessionMaxAgeDays: row.sessionMaxAgeDays,
  };
}

/**
 * Loads everything a route needs for its read/derive logic in one round trip — this app's data is
 * small (dozens of rows, not millions), so fetching it whole and reusing the existing pure JS logic
 * (accrual math, department stats, RBAC checks) is far lower-risk than hand-translating every
 * filter/reduce into SQL. Mutating helpers below write to Postgres AND patch this snapshot in place,
 * so the rest of the same request sees its own writes, matching the old in-memory store's behavior.
 */
export async function loadSnapshot(): Promise<Snapshot> {
  await ensureReady();
  const [departments, employees, leaveTypes, holidays, leaveBalances, leaveRequestRows, settingsRows] = await Promise.all([
    db.select().from(schema.departments),
    // Explicit column list — deliberately excludes password_hash. This snapshot is loaded on
    // nearly every request and its employees flow straight into API responses via hydrateEmployee,
    // so the hash must never be selected here. `hasPassword` is computed in SQL instead, so the
    // real hash never leaves Postgres for this query path. Auth code that genuinely needs the hash
    // (login, change/reset password) uses the dedicated queries in invitation-repo.ts.
    db
      .select({
        id: schema.employees.id,
        name: schema.employees.name,
        email: schema.employees.email,
        avatarUrl: schema.employees.avatarUrl,
        role: schema.employees.role,
        title: schema.employees.title,
        departmentId: schema.employees.departmentId,
        managerId: schema.employees.managerId,
        joinedAt: schema.employees.joinedAt,
        status: schema.employees.status,
        onboardingChecklistId: schema.employees.onboardingChecklistId,
        hasPassword: sql<boolean>`${schema.employees.passwordHash} is not null`,
      })
      .from(schema.employees),
    db.select().from(schema.leaveTypes).orderBy(asc(schema.leaveTypes.name)),
    db.select().from(schema.holidays),
    db.select().from(schema.leaveBalances),
    db.select().from(schema.leaveRequests),
    db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 1)).limit(1),
  ]);

  return {
    departments,
    employees,
    leaveTypes,
    holidays,
    leaveBalances,
    leaveRequests: leaveRequestRows.map(rowToLeaveRequest),
    settings: rowToSettings(settingsRows[0]),
  };
}

// ---- hydration (pure — operates on an already-loaded snapshot) ----

export function hydrateEmployee(snapshot: Snapshot, employee: EmployeeRecord): EmployeeWithRelations {
  const department = snapshot.departments.find((d) => d.id === employee.departmentId)!;
  const manager = employee.managerId ? (snapshot.employees.find((e) => e.id === employee.managerId) ?? null) : null;
  return {
    ...employee,
    department,
    manager: manager ? { id: manager.id, name: manager.name, email: manager.email } : null,
    directReportsCount: directReportsOf(snapshot, employee.id).length,
  };
}

export function hydrateLeaveRequest(snapshot: Snapshot, request: LeaveRequest): LeaveRequestWithRelations {
  const employee = snapshot.employees.find((e) => e.id === request.employeeId)!;
  const leaveType = snapshot.leaveTypes.find((t) => t.id === request.leaveTypeId)!;
  const approver = request.approverId ? (snapshot.employees.find((e) => e.id === request.approverId) ?? null) : null;
  return {
    ...request,
    employee: { id: employee.id, name: employee.name, email: employee.email, avatarUrl: employee.avatarUrl, departmentId: employee.departmentId },
    leaveType,
    approver: approver ? { id: approver.id, name: approver.name, email: approver.email } : null,
  };
}

export function directReportsOf(snapshot: Snapshot, employeeId: string): Employee[] {
  return snapshot.employees.filter((e) => e.managerId === employeeId);
}

/** The first day of `year` the employee is entitled to accrue leave — their join date if they joined that year, otherwise Jan 1. */
function entitlementStart(employee: Employee, year: number): Date {
  const joinDate = new Date(employee.joinedAt);
  if (joinDate.getFullYear() === year) return joinDate;
  return new Date(Date.UTC(year, 0, 1));
}

function previousYearRemaining(snapshot: Snapshot, employeeId: string, leaveTypeId: string, year: number): number {
  const prior = snapshot.leaveBalances.find((b) => b.employeeId === employeeId && b.leaveTypeId === leaveTypeId && b.year === year - 1);
  if (!prior) return 0;
  return Math.max(0, prior.allocated - prior.used);
}

/** Returns the balance row for (employee, leaveType, year), creating and persisting it first if it doesn't exist yet. */
export async function getOrCreateBalance(snapshot: Snapshot, employeeId: string, leaveTypeId: string, year: number): Promise<LeaveBalance> {
  let bal = snapshot.leaveBalances.find((b) => b.employeeId === employeeId && b.leaveTypeId === leaveTypeId && b.year === year);
  if (!bal) {
    const leaveType = snapshot.leaveTypes.find((t) => t.id === leaveTypeId)!;
    const employee = snapshot.employees.find((e) => e.id === employeeId)!;
    const start = entitlementStart(employee, year);
    const monthsAvailable = 12 - start.getUTCMonth();
    const proratedAnnual = Math.round((leaveType.defaultDaysPerYear * monthsAvailable) / 12);
    const carriedForward = Math.max(0, Math.min(leaveType.carryForwardLimit, previousYearRemaining(snapshot, employeeId, leaveTypeId, year)));

    bal = { employeeId, leaveTypeId, year, allocated: proratedAnnual + carriedForward, used: 0, carriedForward };
    await db.insert(schema.leaveBalances).values(bal);
    snapshot.leaveBalances.push(bal);
  }
  return bal;
}

/**
 * How much of `balance.allocated` is actually usable as of today. For ANNUAL leave types the full
 * amount is available immediately; for MONTHLY types it accrues proportionally through the year, so a
 * request in February can't spend days that won't exist until November.
 */
export function accruedToDate(employee: Employee, leaveType: LeaveType, balance: LeaveBalance): number {
  if (leaveType.accrualMethod === "ANNUAL") return balance.allocated;

  const today = new Date();
  if (balance.year < today.getUTCFullYear()) return balance.allocated;
  if (balance.year > today.getUTCFullYear()) return balance.carriedForward;

  const start = entitlementStart(employee, balance.year);
  const monthsAvailable = 12 - start.getUTCMonth();
  const freshAnnual = balance.allocated - balance.carriedForward;
  const monthsElapsed = Math.min(monthsAvailable, Math.max(0, today.getUTCMonth() - start.getUTCMonth() + 1));
  const accruedFresh = Math.round((freshAnnual * monthsElapsed) / Math.max(1, monthsAvailable));
  return balance.carriedForward + Math.min(freshAnnual, accruedFresh);
}

export async function setBalanceUsed(employeeId: string, leaveTypeId: string, year: number, used: number): Promise<void> {
  await db
    .update(schema.leaveBalances)
    .set({ used })
    .where(and(eq(schema.leaveBalances.employeeId, employeeId), eq(schema.leaveBalances.leaveTypeId, leaveTypeId), eq(schema.leaveBalances.year, year)));
}

export async function nextRequestId(): Promise<{ id: string; referenceNumber: string }> {
  const rows = (await db.execute(sql`select nextval('leave_request_seq') as seq`)) as unknown as { seq: string }[];
  const seq = Number(rows[0].seq);
  return { id: randomUUID(), referenceNumber: `LR-${CURRENT_YEAR}-${String(seq).padStart(4, "0")}` };
}

export async function logAudit(actor: Pick<Employee, "id" | "name">, action: string, targetType: string, targetLabel: string, details?: string): Promise<void> {
  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    timestamp: new Date(),
    actorId: actor.id,
    actorName: actor.name,
    action,
    targetType,
    targetLabel,
    details: details ?? null,
  });
}

export async function getAuditLog(limit: number): Promise<AuditLogEntry[]> {
  const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.timestamp)).limit(limit);
  return rows.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() }));
}

// ---- departments ----

export async function insertDepartment(department: Department): Promise<void> {
  await db.insert(schema.departments).values(department);
}
export async function updateDepartmentName(id: string, name: string): Promise<void> {
  await db.update(schema.departments).set({ name }).where(eq(schema.departments.id, id));
}
export async function deleteDepartment(id: string): Promise<void> {
  await db.delete(schema.departments).where(eq(schema.departments.id, id));
}

// ---- employees ----

export async function insertEmployee(employee: Employee): Promise<void> {
  await db.insert(schema.employees).values(employee);
}
export async function updateEmployee(id: string, patch: Partial<Omit<Employee, "id">>): Promise<void> {
  await db.update(schema.employees).set(patch).where(eq(schema.employees.id, id));
}

// ---- holidays ----

export async function insertHoliday(holiday: Holiday): Promise<void> {
  await db.insert(schema.holidays).values(holiday);
}
export async function updateHoliday(id: string, patch: Partial<Omit<Holiday, "id">>): Promise<void> {
  await db.update(schema.holidays).set(patch).where(eq(schema.holidays.id, id));
}
export async function deleteHoliday(id: string): Promise<void> {
  await db.delete(schema.holidays).where(eq(schema.holidays.id, id));
}

// ---- leave types ----

export async function insertLeaveType(leaveType: LeaveType): Promise<void> {
  await db.insert(schema.leaveTypes).values(leaveType);
}
export async function updateLeaveType(id: string, patch: Partial<Omit<LeaveType, "id">>): Promise<void> {
  await db.update(schema.leaveTypes).set(patch).where(eq(schema.leaveTypes.id, id));
}
export async function deleteLeaveType(id: string): Promise<void> {
  await db.delete(schema.leaveBalances).where(eq(schema.leaveBalances.leaveTypeId, id));
  await db.delete(schema.leaveTypes).where(eq(schema.leaveTypes.id, id));
}

// ---- leave requests ----

export async function insertLeaveRequest(request: LeaveRequest): Promise<void> {
  await db.insert(schema.leaveRequests).values({
    ...request,
    appliedAt: new Date(request.appliedAt),
    decidedAt: request.decidedAt ? new Date(request.decidedAt) : null,
  });
}

export async function decideLeaveRequest(id: string, status: LeaveStatus, approverComment: string | null, decidedAt: string): Promise<void> {
  await db.update(schema.leaveRequests).set({ status, approverComment, decidedAt: new Date(decidedAt) }).where(eq(schema.leaveRequests.id, id));
}

/** Like decideLeaveRequest, but leaves approverComment untouched — used when an employee cancels their own request. */
export async function cancelLeaveRequest(id: string, decidedAt: string): Promise<void> {
  await db.update(schema.leaveRequests).set({ status: "CANCELLED", decidedAt: new Date(decidedAt) }).where(eq(schema.leaveRequests.id, id));
}

// ---- settings ----

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const [row] = await db.update(schema.appSettings).set(patch).where(eq(schema.appSettings.id, 1)).returning();
  return rowToSettings(row);
}
