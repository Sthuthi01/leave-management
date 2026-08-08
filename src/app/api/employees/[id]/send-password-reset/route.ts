import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { loadSnapshot, logAudit } from "@/lib/db/repo";
import { sendPasswordResetLink } from "@/lib/invitation-service";
import { withApiHandler } from "@/lib/api-handler";

export const POST = withApiHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can send password reset links.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const employee = snapshot.employees.find((e) => e.id === id);
  if (!employee) return errorResponse(404, "Employee not found.");
  if (employee.status === "INACTIVE") return errorResponse(400, "This account is deactivated — reactivate it first.");
  if (!employee.hasPassword) return errorResponse(400, "This account hasn't been activated yet. Use Resend Invitation instead.");

  await sendPasswordResetLink(employee.id, employee.name, employee.email);
  await logAudit(user, "Sent password reset link", "Employee", employee.name, `Password reset link sent to ${employee.email}`);

  return NextResponse.json({ ok: true });
});
