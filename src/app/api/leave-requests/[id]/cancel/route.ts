import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { cancelLeaveRequest, hydrateLeaveRequest, loadSnapshot, logAudit, setBalanceUsed } from "@/lib/db/repo";
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

  if (leaveRequest.status === "APPROVED") {
    const year = new Date(leaveRequest.startDate).getFullYear();
    const balance = snapshot.leaveBalances.find((b) => b.employeeId === leaveRequest.employeeId && b.leaveTypeId === leaveRequest.leaveTypeId && b.year === year);
    if (balance) await setBalanceUsed(leaveRequest.employeeId, leaveRequest.leaveTypeId, year, Math.max(0, balance.used - leaveRequest.days));
  }

  const decidedAt = new Date().toISOString();
  await cancelLeaveRequest(id, decidedAt);
  await logAudit(user, "Cancelled leave", "LeaveRequest", `${leaveRequest.referenceNumber} — ${user.name}`);

  leaveRequest.status = "CANCELLED";
  leaveRequest.decidedAt = decidedAt;
  return NextResponse.json(hydrateLeaveRequest(snapshot, leaveRequest));
});
