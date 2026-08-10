import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { cancelLeaveRequestTx, hydrateLeaveRequest, loadSnapshot, logAudit, type BalanceAdjustment } from "@/lib/db/repo";
import { withApiHandler } from "@/lib/api-handler";

export const POST = withApiHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const leaveRequest = snapshot.leaveRequests.find((r) => r.id === id);
  if (!leaveRequest) return errorResponse(404, "Leave request not found.");
  if (leaveRequest.employeeId !== user.id) return errorResponse(403, "You can only cancel your own leave requests.");
  if (leaveRequest.status !== "PENDING" && leaveRequest.status !== "APPROVED") {
    return errorResponse(400, "Only pending or approved requests can be cancelled.");
  }

  // Capture this before the atomic cancel below, which is the source of truth for whether the
  // cancel actually happened — the balance should only be released if it does.
  let balanceAdjustment: BalanceAdjustment | null = null;
  if (leaveRequest.status === "APPROVED") {
    const year = new Date(leaveRequest.startDate).getFullYear();
    const balance = snapshot.leaveBalances.find((b) => b.employeeId === leaveRequest.employeeId && b.leaveTypeId === leaveRequest.leaveTypeId && b.year === year);
    if (balance) balanceAdjustment = { employeeId: leaveRequest.employeeId, leaveTypeId: leaveRequest.leaveTypeId, year, days: -leaveRequest.days };
  }

  // Atomically claim the cancel and release the balance together, in one database transaction —
  // see decideLeaveRequestTx's comment for why (a partial failure can't leave the request
  // cancelled without its days actually released, or the reverse).
  const decidedAt = new Date().toISOString();
  const applied = await cancelLeaveRequestTx(id, decidedAt, balanceAdjustment);
  if (!applied) {
    return errorResponse(409, "This request's status just changed — refresh and try again.");
  }

  await logAudit(user, "Cancelled leave", "LeaveRequest", `${leaveRequest.referenceNumber} — ${user.name}`);

  leaveRequest.status = "CANCELLED";
  leaveRequest.decidedAt = decidedAt;
  return NextResponse.json(hydrateLeaveRequest(snapshot, leaveRequest));
});
