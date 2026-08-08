import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { deleteLeaveType, loadSnapshot, logAudit, updateLeaveType } from "@/lib/db/repo";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can edit leave types.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const leaveType = snapshot.leaveTypes.find((t) => t.id === id);
  if (!leaveType) return errorResponse(404, "Leave type not found.");

  const body = await request.json().catch(() => null);
  if (body?.defaultDaysPerYear !== undefined && (Number.isNaN(Number(body.defaultDaysPerYear)) || Number(body.defaultDaysPerYear) < 0)) {
    return errorResponse(400, "defaultDaysPerYear must be a non-negative number.");
  }
  if (body?.carryForwardLimit !== undefined && (Number.isNaN(Number(body.carryForwardLimit)) || Number(body.carryForwardLimit) < 0)) {
    return errorResponse(400, "carryForwardLimit must be a non-negative number.");
  }
  if (body?.accrualMethod && body.accrualMethod !== "ANNUAL" && body.accrualMethod !== "MONTHLY") {
    return errorResponse(400, "accrualMethod must be ANNUAL or MONTHLY.");
  }

  const patch = {
    name: body?.name?.trim() ?? leaveType.name,
    color: body?.color ?? leaveType.color,
    defaultDaysPerYear: body?.defaultDaysPerYear !== undefined ? Number(body.defaultDaysPerYear) : leaveType.defaultDaysPerYear,
    requiresApproval: body?.requiresApproval ?? leaveType.requiresApproval,
    isActive: body?.isActive ?? leaveType.isActive,
    accrualMethod: body?.accrualMethod ?? leaveType.accrualMethod,
    carryForwardLimit: body?.carryForwardLimit !== undefined ? Number(body.carryForwardLimit) : leaveType.carryForwardLimit,
  };
  await updateLeaveType(id, patch);
  await logAudit(user, "Edited leave type", "LeaveType", patch.name);

  return NextResponse.json({ ...leaveType, ...patch });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can remove leave types.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const leaveType = snapshot.leaveTypes.find((t) => t.id === id);
  if (!leaveType) return errorResponse(404, "Leave type not found.");
  if (snapshot.leaveRequests.some((r) => r.leaveTypeId === id)) {
    return errorResponse(400, "This leave type has requests on record. Deactivate it instead of deleting.");
  }

  await deleteLeaveType(id);
  await logAudit(user, "Removed leave type", "LeaveType", leaveType.name);
  return NextResponse.json({ ok: true });
}
