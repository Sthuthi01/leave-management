import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { insertLeaveType, loadSnapshot, logAudit } from "@/lib/db/repo";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  const snapshot = await loadSnapshot();
  return NextResponse.json(snapshot.leaveTypes);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can add leave types.");

  const body = await request.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim();
  const code = (body?.code as string | undefined)?.trim().toUpperCase();
  const color = (body?.color as string | undefined) || "#2563eb";
  const defaultDaysPerYear = Number(body?.defaultDaysPerYear);
  const requiresApproval = body?.requiresApproval !== false;

  if (!name || !code || Number.isNaN(defaultDaysPerYear) || defaultDaysPerYear < 0) {
    return errorResponse(400, "name, code and a non-negative defaultDaysPerYear are required.");
  }

  const snapshot = await loadSnapshot();
  if (snapshot.leaveTypes.some((t) => t.code === code)) return errorResponse(409, "A leave type with this code already exists.");

  const leaveType = {
    id: `lt-${Date.now()}`,
    name,
    code,
    color,
    defaultDaysPerYear,
    requiresApproval,
    isActive: true,
    accrualMethod: "ANNUAL" as const,
    carryForwardLimit: 0,
  };
  await insertLeaveType(leaveType);
  await logAudit(user, "Added leave type", "LeaveType", leaveType.name);
  return NextResponse.json(leaveType, { status: 201 });
}
