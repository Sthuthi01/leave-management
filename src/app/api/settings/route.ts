import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { loadSnapshot, logAudit, updateSettings } from "@/lib/db/repo";
import type { AppSettings } from "@/types";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  const snapshot = await loadSnapshot();
  return NextResponse.json(snapshot.settings);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can change settings.");

  const body = await request.json().catch(() => null);
  const patch: Partial<AppSettings> = {};

  if (body?.workingDays !== undefined) {
    const days = body.workingDays;
    if (!Array.isArray(days) || days.length === 0 || !days.every((d: unknown) => typeof d === "number" && d >= 0 && d <= 6)) {
      return errorResponse(400, "workingDays must be a non-empty array of numbers 0–6.");
    }
    patch.workingDays = [...new Set(days)].sort();
  }
  if (body?.upcomingLeaveWindowDays !== undefined) {
    if (!isPositiveInt(body.upcomingLeaveWindowDays)) return errorResponse(400, "upcomingLeaveWindowDays must be a positive whole number.");
    patch.upcomingLeaveWindowDays = body.upcomingLeaveWindowDays;
  }
  if (body?.pendingApprovalUrgencyDays !== undefined) {
    if (!isPositiveInt(body.pendingApprovalUrgencyDays)) return errorResponse(400, "pendingApprovalUrgencyDays must be a positive whole number.");
    patch.pendingApprovalUrgencyDays = body.pendingApprovalUrgencyDays;
  }
  if (body?.auditLogDisplayLimit !== undefined) {
    if (!isPositiveInt(body.auditLogDisplayLimit)) return errorResponse(400, "auditLogDisplayLimit must be a positive whole number.");
    patch.auditLogDisplayLimit = body.auditLogDisplayLimit;
  }
  if (body?.sessionMaxAgeDays !== undefined) {
    if (!isPositiveInt(body.sessionMaxAgeDays)) return errorResponse(400, "sessionMaxAgeDays must be a positive whole number.");
    patch.sessionMaxAgeDays = body.sessionMaxAgeDays;
  }

  const settings = await updateSettings(patch);
  await logAudit(user, "Updated settings", "Settings", "Organization settings");
  return NextResponse.json(settings);
}
