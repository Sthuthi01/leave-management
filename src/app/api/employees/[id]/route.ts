import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { hydrateEmployee, loadSnapshot, logAudit, updateEmployee } from "@/lib/db/repo";
import { checklistExists } from "@/lib/db/onboarding-repo";
import { withApiHandler } from "@/lib/api-handler";

export const PATCH = withApiHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can edit employees.");

  const { id } = await params;
  const snapshot = await loadSnapshot();
  const employee = snapshot.employees.find((e) => e.id === id);
  if (!employee) return errorResponse(404, "Employee not found.");

  const body = await request.json().catch(() => null);
  if (body?.email && !z.string().email().safeParse(body.email.trim().toLowerCase()).success) {
    return errorResponse(400, "Enter a valid email address.");
  }
  if (body?.managerId === id) return errorResponse(400, "An employee cannot be their own manager.");
  if (body?.departmentId && !snapshot.departments.some((d) => d.id === body.departmentId)) return errorResponse(400, "Unknown department.");
  if (body?.managerId && !snapshot.employees.some((e) => e.id === body.managerId)) return errorResponse(400, "Unknown manager.");
  if (body?.onboardingChecklistId && !(await checklistExists(body.onboardingChecklistId))) {
    return errorResponse(400, "Unknown onboarding checklist.");
  }

  if (body?.status === "INACTIVE") {
    if (id === user.id) return errorResponse(400, "You cannot deactivate your own account.");
    if (snapshot.employees.some((e) => e.managerId === id && e.status === "ACTIVE")) {
      return errorResponse(400, "Reassign this person's direct reports before deactivating them.");
    }
  }

  const previousStatus = employee.status;
  const patch = {
    name: body?.name?.trim() ?? employee.name,
    title: body?.title?.trim() ?? employee.title,
    email: body?.email?.trim().toLowerCase() ?? employee.email,
    role: body?.role ?? employee.role,
    departmentId: body?.departmentId ?? employee.departmentId,
    managerId: body?.managerId === undefined ? employee.managerId : body.managerId || null,
    status: body?.status ?? employee.status,
    onboardingChecklistId: body?.onboardingChecklistId === undefined ? employee.onboardingChecklistId : body.onboardingChecklistId || null,
  };
  await updateEmployee(id, patch);
  Object.assign(employee, patch);

  if (body?.status && body.status !== previousStatus) {
    await logAudit(user, body.status === "INACTIVE" ? "Deactivated employee" : "Reactivated employee", "Employee", employee.name);
  } else {
    await logAudit(user, "Edited employee", "Employee", employee.name);
  }

  return NextResponse.json(hydrateEmployee(snapshot, employee));
});
