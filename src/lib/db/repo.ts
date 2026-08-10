import { randomUUID } from "crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, ensureReady } from "./client";
import * as schema from "./schema";
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

    const candidate = { employeeId, leaveTypeId, year, allocated: proratedAnnual + carriedForward, used: 0, carriedForward };

    // Two requests for the same (employee, leaveType, year) with no existing balance row can both
    // reach this branch at nearly the same time (e.g. applying for two different leave types'
    // first-ever request in the same instant). ON CONFLICT DO NOTHING makes the losing insert a
    // safe no-op instead of a unique-violation error on the (employeeId, leaveTypeId, year)
    // primary key — both racers compute identical allocated/carriedForward values from the same
    // inputs, so whichever insert actually lands is correct either way. Re-selecting afterward
    // (rather than trusting our own locally-computed `candidate`) guarantees we return what's
    // actually persisted.
    await db
      .insert(schema.leaveBalances)
      .values(candidate)
      .onConflictDoNothing({ target: [schema.leaveBalances.employeeId, schema.leaveBalances.leaveTypeId, schema.leaveBalances.year] });
    const [row] = await db
      .select()
      .from(schema.leaveBalances)
      .where(and(eq(schema.leaveBalances.employeeId, employeeId), eq(schema.leaveBalances.leaveTypeId, leaveTypeId), eq(schema.leaveBalances.year, year)));
    bal = row;
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

export type ApplyLeaveResult =
  | { ok: true; request: LeaveRequest }
  | { ok: false; reason: "OVERLAP"; overlapping: { referenceNumber: string; status: LeaveStatus; startDate: string; endDate: string } }
  | { ok: false; reason: "INSUFFICIENT_BALANCE"; available: number };

/**
 * Runs the entire "apply for leave" critical section — a fresh overlap re-check, the balance cap
 * check for capped leave types, inserting the request, and (if auto-approved) consuming the
 * balance — inside a single database transaction, serialized per employee via a Postgres advisory
 * lock taken as the transaction's very first statement.
 *
 * Why this exists: the overlap check and the balance cap check are both "read current state, then
 * decide" — unlike decideLeaveRequestTx/cancelLeaveRequestTx below, there's no status column to
 * condition an atomic UPDATE on here, since this is an INSERT. Two concurrent apply calls for the
 * same employee (a double-click, a client retry after a slow network, two open tabs) could
 * otherwise both read "no overlap yet" before either had committed, and both succeed — creating
 * duplicate overlapping requests, or in the auto-approve case, both passing the same balance cap
 * check and jointly overspending it. `pg_advisory_xact_lock(hashtext(employeeId))` forces the
 * second call to block until the first fully commits or rolls back before it even starts its own
 * checks, so it correctly sees whatever the first one did. Scoped per employee (not global) so two
 * different employees applying at the same moment never wait on each other.
 */
export async function applyLeaveRequestAtomic(
  snapshot: Snapshot,
  employee: Employee,
  leaveType: LeaveType,
  params: { startDate: string; endDate: string; days: number; reason: string; requiresApproval: boolean; approverId: string | null }
): Promise<ApplyLeaveResult> {
  const year = new Date(params.startDate).getFullYear();
  const isCapped = leaveType.defaultDaysPerYear > 0;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employee.id}))`);

    // A person can't be on two leaves at once, regardless of leave type — re-verified here
    // (rather than trusting the snapshot loaded before the lock) because that snapshot could
    // already be stale by the time we actually hold the lock.
    const [overlap] = await tx
      .select({
        referenceNumber: schema.leaveRequests.referenceNumber,
        status: schema.leaveRequests.status,
        startDate: schema.leaveRequests.startDate,
        endDate: schema.leaveRequests.endDate,
      })
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.employeeId, employee.id),
          inArray(schema.leaveRequests.status, ["PENDING", "APPROVED"]),
          lte(schema.leaveRequests.startDate, params.endDate),
          gte(schema.leaveRequests.endDate, params.startDate)
        )
      )
      .limit(1);
    if (overlap) return { ok: false, reason: "OVERLAP", overlapping: overlap };

    let available = Infinity;
    let usedSoFar = 0;
    if (isCapped) {
      // Same upsert-then-reselect shape as getOrCreateBalance, but running inside this same
      // locked transaction (via `tx`, not `db`) so it's part of the same atomic, serialized unit.
      const start = entitlementStart(employee, year);
      const monthsAvailable = 12 - start.getUTCMonth();
      const proratedAnnual = Math.round((leaveType.defaultDaysPerYear * monthsAvailable) / 12);
      const carriedForward = Math.max(0, Math.min(leaveType.carryForwardLimit, previousYearRemaining(snapshot, employee.id, leaveType.id, year)));

      await tx
        .insert(schema.leaveBalances)
        .values({ employeeId: employee.id, leaveTypeId: leaveType.id, year, allocated: proratedAnnual + carriedForward, used: 0, carriedForward })
        .onConflictDoNothing({ target: [schema.leaveBalances.employeeId, schema.leaveBalances.leaveTypeId, schema.leaveBalances.year] });
      const [bal] = await tx
        .select()
        .from(schema.leaveBalances)
        .where(and(eq(schema.leaveBalances.employeeId, employee.id), eq(schema.leaveBalances.leaveTypeId, leaveType.id), eq(schema.leaveBalances.year, year)));

      available = accruedToDate(employee, leaveType, bal);
      usedSoFar = bal.used;
      if (params.days > available - usedSoFar) {
        return { ok: false, reason: "INSUFFICIENT_BALANCE", available: Math.max(0, available - usedSoFar) };
      }
    }

    const seqRows = (await tx.execute(sql`select nextval('leave_request_seq') as seq`)) as unknown as { seq: string }[];
    const referenceNumber = `LR-${new Date().getFullYear()}-${String(Number(seqRows[0].seq)).padStart(4, "0")}`;
    const id = randomUUID();
    const status: LeaveStatus = params.requiresApproval ? "PENDING" : "APPROVED";
    const now = new Date();

    await tx.insert(schema.leaveRequests).values({
      id,
      referenceNumber,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      startDate: params.startDate,
      endDate: params.endDate,
      days: params.days,
      reason: params.reason,
      status,
      approverId: params.requiresApproval ? params.approverId : null,
      approverComment: null,
      appliedAt: now,
      decidedAt: params.requiresApproval ? null : now,
    });

    if (!params.requiresApproval && isCapped) {
      await tx
        .update(schema.leaveBalances)
        .set({ used: sql`greatest(0, ${schema.leaveBalances.used} + ${params.days})` })
        .where(and(eq(schema.leaveBalances.employeeId, employee.id), eq(schema.leaveBalances.leaveTypeId, leaveType.id), eq(schema.leaveBalances.year, year)));
    }

    return {
      ok: true,
      request: {
        id,
        referenceNumber,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: params.startDate,
        endDate: params.endDate,
        days: params.days,
        reason: params.reason,
        status,
        approverId: params.requiresApproval ? params.approverId : null,
        approverComment: null,
        appliedAt: now.toISOString(),
        decidedAt: params.requiresApproval ? null : now.toISOString(),
      },
    };
  });
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

export interface BalanceAdjustment {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  /** Positive to consume days (approval), negative to release them (cancellation). */
  days: number;
}

/**
 * Atomically transitions a request from PENDING to APPROVED/REJECTED and — in the same database
 * transaction — applies the resulting balance change, if any. Two things this closes at once:
 *
 * 1. The `status = 'PENDING'` condition in the WHERE clause is a mutex, not just a filter. Without
 *    it, two decide requests for the same leave request landing at nearly the same time (a
 *    double-click, two browser tabs) could both read status "PENDING" before either write
 *    happened and both go on to award the balance change, double-counting that single request's
 *    days. Returns whether this call actually made the change — false means a concurrent call
 *    already won, and the balance is deliberately left untouched in that case.
 * 2. Wrapping the status update and the balance update in one transaction means a failure in
 *    either half rolls back both — a request can never end up marked APPROVED with its balance
 *    change never applied (or the reverse), even if the process crashes or the database hiccups
 *    partway through.
 */
export async function decideLeaveRequestTx(
  id: string,
  status: LeaveStatus,
  approverComment: string | null,
  decidedAt: string,
  balanceAdjustment: BalanceAdjustment | null
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.leaveRequests)
      .set({ status, approverComment, decidedAt: new Date(decidedAt) })
      .where(and(eq(schema.leaveRequests.id, id), eq(schema.leaveRequests.status, "PENDING")))
      .returning({ id: schema.leaveRequests.id });
    if (updated.length === 0) return false;

    if (balanceAdjustment) {
      const { employeeId, leaveTypeId, year, days } = balanceAdjustment;
      await tx
        .update(schema.leaveBalances)
        .set({ used: sql`greatest(0, ${schema.leaveBalances.used} + ${days})` })
        .where(and(eq(schema.leaveBalances.employeeId, employeeId), eq(schema.leaveBalances.leaveTypeId, leaveTypeId), eq(schema.leaveBalances.year, year)));
    }
    return true;
  });
}

/**
 * Like decideLeaveRequestTx, but leaves approverComment untouched and accepts either PENDING or
 * APPROVED as the starting state — used when an employee cancels their own request. Same mutex
 * and same-transaction reasoning: the status condition prevents a duplicate/racing cancel from
 * double-releasing the balance days, and wrapping both writes together means a failure partway
 * through can't leave the request cancelled without its balance days actually released (or vice
 * versa).
 */
export async function cancelLeaveRequestTx(id: string, decidedAt: string, balanceAdjustment: BalanceAdjustment | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.leaveRequests)
      .set({ status: "CANCELLED", decidedAt: new Date(decidedAt) })
      .where(and(eq(schema.leaveRequests.id, id), inArray(schema.leaveRequests.status, ["PENDING", "APPROVED"])))
      .returning({ id: schema.leaveRequests.id });
    if (updated.length === 0) return false;

    if (balanceAdjustment) {
      const { employeeId, leaveTypeId, year, days } = balanceAdjustment;
      await tx
        .update(schema.leaveBalances)
        .set({ used: sql`greatest(0, ${schema.leaveBalances.used} + ${days})` })
        .where(and(eq(schema.leaveBalances.employeeId, employeeId), eq(schema.leaveBalances.leaveTypeId, leaveTypeId), eq(schema.leaveBalances.year, year)));
    }
    return true;
  });
}

// ---- settings ----

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const [row] = await db.update(schema.appSettings).set(patch).where(eq(schema.appSettings.id, 1)).returning();
  return rowToSettings(row);
}
