import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { applyLeaveRequestAtomic, hydrateLeaveRequest, loadSnapshot, logAudit } from "@/lib/db/repo";
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

  const days = calculateLeaveDays(startDate, endDate, snapshot.holidays, snapshot.settings.workingDays);
  if (days <= 0) return errorResponse(400, "The selected range has no working days.");

  if (leaveType.requiresApproval && !user.managerId) {
    return errorResponse(400, "You have no manager assigned to approve this request. Contact HR.");
  }

  // The overlap check and the balance cap check both happen again, freshly, inside this call —
  // not from the `snapshot` above, which could already be stale by the time it runs. See
  // applyLeaveRequestAtomic's own comment for why: without a database-level lock serializing this
  // per employee, a double-click or a client retry could otherwise land two concurrent requests
  // that both see "no overlap yet" and both succeed. Cheap, non-racy checks (leave type
  // active/exists, date validity, has-a-manager) are deliberately done above, before taking the
  // lock, so the lock is held for as little time as possible.
  const result = await applyLeaveRequestAtomic(snapshot, user, leaveType, {
    startDate,
    endDate,
    days,
    reason,
    requiresApproval: leaveType.requiresApproval,
    approverId: user.managerId ?? null,
  });

  if (!result.ok) {
    if (result.reason === "OVERLAP") {
      const o = result.overlapping;
      return errorResponse(400, `This overlaps with ${o.referenceNumber}, which is already ${o.status.toLowerCase()} for ${o.startDate} – ${o.endDate}.`);
    }
    return errorResponse(400, `Insufficient balance: ${result.available} day(s) available for ${leaveType.name}.`);
  }

  await logAudit(
    user,
    leaveType.requiresApproval ? "Applied leave" : "Applied leave (auto-approved)",
    "LeaveRequest",
    `${result.request.referenceNumber} — ${user.name}`
  );
  return NextResponse.json(hydrateLeaveRequest(snapshot, result.request), { status: 201 });
});
