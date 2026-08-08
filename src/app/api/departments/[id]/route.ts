import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { deleteDepartment, loadSnapshot, logAudit, updateDepartmentName } from "@/lib/db/repo";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can edit departments.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const department = snapshot.departments.find((d) => d.id === id);
  if (!department) return errorResponse(404, "Department not found.");

  const body = await request.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim();
  if (!name) return errorResponse(400, "name is required.");
  if (snapshot.departments.some((d) => d.id !== id && d.name.toLowerCase() === name.toLowerCase())) {
    return errorResponse(409, "A department with this name already exists.");
  }

  const previousName = department.name;
  await updateDepartmentName(id, name);
  await logAudit(user, "Edited department", "Department", `${previousName} → ${name}`);

  return NextResponse.json({ ...department, name });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can remove departments.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const department = snapshot.departments.find((d) => d.id === id);
  if (!department) return errorResponse(404, "Department not found.");
  if (snapshot.employees.some((e) => e.departmentId === id)) {
    return errorResponse(400, "This department still has employees assigned. Reassign them before removing it.");
  }

  await deleteDepartment(id);
  await logAudit(user, "Removed department", "Department", department.name);
  return NextResponse.json({ ok: true });
}
