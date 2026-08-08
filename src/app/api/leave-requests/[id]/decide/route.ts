import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { decideLeaveRequest, getOrCreateBalance, hydrateLeaveRequest, loadSnapshot, logAudit, setBalanceUsed } from "@/lib/db/repo";
import { withApiHandler } from "@/lib/api-handler";

export const POST = withApiHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const leaveRequest = snapshot.leaveRequests.find((r) => r.id === id);
  if (!leaveRequest) return errorResponse(404, "Leave request not found.");
  if (leaveRequest.approverId !== user.id) return errorResponse(403, "You are not the approver for this request.");
  if (leaveRequest.status !== "PENDING") return errorResponse(400, "This request has already been decided.");

  const body = await request.json().catch(() => null);
  const decision = body?.decision as "APPROVED" | "REJECTED" | undefined;
  const comment = (body?.comment as string | undefined)?.trim() || null;
  if (decision !== "APPROVED" && decision !== "REJECTED") return errorResponse(400, "decision must be APPROVED or REJECTED.");
  // A bare rejection with no explanation is the top source of employee frustration with approval
  // systems, so — unlike approval — a reason is mandatory here.
  if (decision === "REJECTED" && !comment) return errorResponse(400, "A comment is required when rejecting a request.");

  const employee = snapshot.employees.find((e) => e.id === leaveRequest.employeeId)!;
  if (decision === "APPROVED") {
    const leaveType = snapshot.leaveTypes.find((t) => t.id === leaveRequest.leaveTypeId)!;
    if (leaveType.defaultDaysPerYear > 0) {
      const year = new Date(leaveRequest.startDate).getFullYear();
      const balance = await getOrCreateBalance(snapshot, leaveRequest.employeeId, leaveRequest.leaveTypeId, year);
      await setBalanceUsed(leaveRequest.employeeId, leaveRequest.leaveTypeId, year, balance.used + leaveRequest.days);
    }
  }

  const decidedAt = new Date().toISOString();
  await decideLeaveRequest(id, decision, comment, decidedAt);
  await logAudit(user, decision === "APPROVED" ? "Approved leave" : "Rejected leave", "LeaveRequest", `${leaveRequest.referenceNumber} — ${employee.name}`, comment ?? undefined);

  leaveRequest.status = decision;
  leaveRequest.approverComment = comment;
  leaveRequest.decidedAt = decidedAt;
  return NextResponse.json(hydrateLeaveRequest(snapshot, leaveRequest));
});
