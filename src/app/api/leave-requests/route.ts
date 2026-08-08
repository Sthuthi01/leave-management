import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { accruedToDate, getOrCreateBalance, hydrateLeaveRequest, insertLeaveRequest, loadSnapshot, logAudit, nextRequestId, setBalanceUsed } from "@/lib/db/repo";
import { calculateLeaveDays } from "@/lib/business-days";
import { withApiHandler } from "@/lib/api-handler";
import type { LeaveStatus } from "@/types";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Rejects anything that isn't a real, well-formed calendar date — without this, a malformed
// string (e.g. from a direct API call bypassing the UI's date picker) would silently skip the
// backdate/ordering checks below, since those compare dates as plain strings.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be in YYYY-MM-DD format.")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date.");

const createLeaveRequestSchema = z.object({
  leaveTypeId: z.string().min(1, "leaveTypeId is required."),
  startDate: isoDate,
  endDate: isoDate,
  reason: z.string().trim().max(2000, "Reason must be 2000 characters or fewer.").optional(),
});

export const GET = withApiHandler(async (request: NextRequest) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const scope = request.nextUrl.searchParams.get("scope") ?? "mine";
  const status = request.nextUrl.searchParams.get("status") as LeaveStatus | null;

  const snapshot = await loadSnapshot();
  let requests = snapshot.leaveRequests;
  if (scope === "approvals") {
    requests = requests.filter((r) => r.approverId === user.id);
  } else {
    requests = requests.filter((r) => r.employeeId === user.id);
  }
  if (status) requests = requests.filter((r) => r.status === status);

  const hydrated = requests.map((r) => hydrateLeaveRequest(snapshot, r)).sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  return NextResponse.json(hydrated);
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const body = await request.json().catch(() => null);
  const parsed = createLeaveRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  const { leaveTypeId, startDate, endDate } = parsed.data;
  const reason = parsed.data.reason ?? "";

  if (new Date(startDate) > new Date(endDate)) {
    return errorResponse(400, "Start date must be on or before the end date.");
  }
  if (startDate < todayISO()) {
    return errorResponse(400, "Leave can't be applied for a date in the past.");
  }

  const snapshot = await loadSnapshot();
  const leaveType = snapshot.leaveTypes.find((t) => t.id === leaveTypeId);
  if (!leaveType || !leaveType.isActive) return errorResponse(400, "Unknown or inactive leave type.");

  // A person can't be on two leaves at once, regardless of leave type.
  const overlapping = snapshot.leaveRequests.find(
    (r) => r.employeeId === user.id && (r.status === "PENDING" || r.status === "APPROVED") && r.startDate <= endDate && r.endDate >= startDate
  );
  if (overlapping) {
    return errorResponse(400, `This overlaps with ${overlapping.referenceNumber}, which is already ${overlapping.status.toLowerCase()} for ${overlapping.startDate} – ${overlapping.endDate}.`);
  }

  const days = calculateLeaveDays(startDate, endDate, snapshot.holidays, snapshot.settings.workingDays);
  if (days <= 0) return errorResponse(400, "The selected range has no working days.");

  // Leave types with no annual cap (e.g. Unpaid Leave) skip the balance check entirely.
  const isCapped = leaveType.defaultDaysPerYear > 0;
  const year = new Date(startDate).getFullYear();
  const balance = await getOrCreateBalance(snapshot, user.id, leaveType.id, year);
  const available = isCapped ? accruedToDate(user, leaveType, balance) : Infinity;
  if (isCapped && days > available - balance.used) {
    return errorResponse(400, `Insufficient balance: ${Math.max(0, available - balance.used)} day(s) available for ${leaveType.name}.`);
  }

  if (!leaveType.requiresApproval) {
    if (isCapped) await setBalanceUsed(user.id, leaveType.id, year, balance.used + days);
    const { id, referenceNumber } = await nextRequestId();
    const newRequest = {
      id,
      referenceNumber,
      employeeId: user.id,
      leaveTypeId,
      startDate,
      endDate,
      days,
      reason,
      status: "APPROVED" as const,
      approverId: null,
      approverComment: null,
      appliedAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
    };
    await insertLeaveRequest(newRequest);
    await logAudit(user, "Applied leave (auto-approved)", "LeaveRequest", `${referenceNumber} — ${user.name}`);
    return NextResponse.json(hydrateLeaveRequest(snapshot, newRequest), { status: 201 });
  }

  if (!user.managerId) {
    return errorResponse(400, "You have no manager assigned to approve this request. Contact HR.");
  }

  const { id, referenceNumber } = await nextRequestId();
  const newRequest = {
    id,
    referenceNumber,
    employeeId: user.id,
    leaveTypeId,
    startDate,
    endDate,
    days,
    reason,
    status: "PENDING" as const,
    approverId: user.managerId,
    approverComment: null,
    appliedAt: new Date().toISOString(),
    decidedAt: null,
  };
  await insertLeaveRequest(newRequest);
  await logAudit(user, "Applied leave", "LeaveRequest", `${referenceNumber} — ${user.name}`);
  return NextResponse.json(hydrateLeaveRequest(snapshot, newRequest), { status: 201 });
});
