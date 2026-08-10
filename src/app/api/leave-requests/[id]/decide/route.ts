import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { decideLeaveRequestTx, hydrateLeaveRequest, loadSnapshot, logAudit, type BalanceAdjustment } from "@/lib/db/repo";
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

  // The balance row for a capped leave type is always created at apply time (see
  // applyLeaveRequestAtomic, which checks/creates it up front for every capped type, whether or
  // not approval is required) — so by the time a request reaches decide, it's guaranteed to
  // already exist. No need to re-ensure it here; just describe the adjustment to make if approved.
  let balanceAdjustment: BalanceAdjustment | null = null;
  if (decision === "APPROVED") {
    const leaveType = snapshot.leaveTypes.find((t) => t.id === leaveRequest.leaveTypeId)!;
    if (leaveType.defaultDaysPerYear > 0) {
      const year = new Date(leaveRequest.startDate).getFullYear();
      balanceAdjustment = { employeeId: leaveRequest.employeeId, leaveTypeId: leaveRequest.leaveTypeId, year, days: leaveRequest.days };
    }
  }

  // Atomically claim the PENDING -> decision transition and apply the balance change together, in
  // one database transaction. If the transition doesn't affect a row, someone else already decided
  // this exact request (a double-click, two tabs, a genuine race) between our read above and now —
  // bail out rather than awarding a second balance change for a request already decided once. If it
  // does succeed, the balance change is applied in the same transaction, so a failure partway
  // through can never leave the request decided without its balance change (or the reverse).
  const decidedAt = new Date().toISOString();
  const applied = await decideLeaveRequestTx(id, decision, comment, decidedAt, balanceAdjustment);
  if (!applied) {
    return errorResponse(409, "This request was already decided — refresh and try again.");
  }

  await logAudit(user, decision === "APPROVED" ? "Approved leave" : "Rejected leave", "LeaveRequest", `${leaveRequest.referenceNumber} — ${employee.name}`, comment ?? undefined);

  leaveRequest.status = decision;
  leaveRequest.approverComment = comment;
  leaveRequest.decidedAt = decidedAt;
  return NextResponse.json(hydrateLeaveRequest(snapshot, leaveRequest));
});
