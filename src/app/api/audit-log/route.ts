import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { getAuditLog, loadSnapshot } from "@/lib/db/repo";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can view the audit log.");

  const snapshot = await loadSnapshot();
  const entries = await getAuditLog(snapshot.settings.auditLogDisplayLimit);
  return NextResponse.json(entries);
}
