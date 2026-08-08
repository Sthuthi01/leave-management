import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { insertDepartment, loadSnapshot, logAudit } from "@/lib/db/repo";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  const snapshot = await loadSnapshot();
  return NextResponse.json(snapshot.departments);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can add departments.");

  const body = await request.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim();
  if (!name) return errorResponse(400, "name is required.");

  const snapshot = await loadSnapshot();
  if (snapshot.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
    return errorResponse(409, "A department with this name already exists.");
  }

  const department = { id: `dept-${Date.now()}`, name };
  await insertDepartment(department);
  await logAudit(user, "Added department", "Department", department.name);
  return NextResponse.json(department, { status: 201 });
}
