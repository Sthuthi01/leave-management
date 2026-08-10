import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { hydrateEmployee, insertEmployee, loadSnapshot, logAudit } from "@/lib/db/repo";
import { checklistExists } from "@/lib/db/onboarding-repo";
import { inviteEmployee } from "@/lib/invitation-service";
import { withApiHandler } from "@/lib/api-handler";
import type { Role } from "@/types";

// Full-roster read — every field here (including account status and onboarding state) is meant
// for HR/admin use (the employee directory, department headcounts, the manager-picker dropdown),
// all of which live behind admin-only pages. Gated the same as the mutating actions below, not
// just "signed in", so a regular employee can't pull the entire company roster (who's inactive,
// who hasn't activated their account yet, etc.) via a direct API call — see the Guardrail Audit.
export const GET = withApiHandler(async (request: NextRequest) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can view the employee directory.");
  const snapshot = await loadSnapshot();
  const employees = snapshot.employees.map((e) => hydrateEmployee(snapshot, e)).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(employees);
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can add employees.");

  const body = await request.json().catch(() => null);
  const name = (body?.name as string | undefined)?.trim();
  const email = (body?.email as string | undefined)?.trim().toLowerCase();
  const title = (body?.title as string | undefined)?.trim();
  const departmentId = body?.departmentId as string | undefined;
  const managerId = (body?.managerId as string | undefined) || null;
  const role = (body?.role as Role | undefined) ?? "EMPLOYEE";
  const onboardingChecklistId = (body?.onboardingChecklistId as string | undefined) || null;

  if (!name || !email || !title || !departmentId) {
    return errorResponse(400, "name, email, title and departmentId are required.");
  }
  if (!z.string().email().safeParse(email).success) return errorResponse(400, "Enter a valid email address.");

  const snapshot = await loadSnapshot();
  if (!snapshot.departments.some((d) => d.id === departmentId)) return errorResponse(400, "Unknown department.");
  if (managerId && !snapshot.employees.some((e) => e.id === managerId)) return errorResponse(400, "Unknown manager.");
  if (snapshot.employees.some((e) => e.email === email)) return errorResponse(409, "An employee with this email already exists.");
  if (onboardingChecklistId && !(await checklistExists(onboardingChecklistId))) return errorResponse(400, "Unknown onboarding checklist.");

  const employee = {
    id: `emp-${Date.now()}`,
    name,
    email,
    avatarUrl: null,
    role,
    title,
    departmentId,
    managerId,
    joinedAt: new Date().toISOString().slice(0, 10),
    status: "ACTIVE" as const,
    onboardingChecklistId,
  };
  await insertEmployee(employee);
  await logAudit(user, "Added employee", "Employee", employee.name, `Invitation sent to ${employee.email}`);

  const employeeRecord = { ...employee, hasPassword: false };
  snapshot.employees.push(employeeRecord);

  await inviteEmployee(employee.id, employee.name, employee.email);

  return NextResponse.json(hydrateEmployee(snapshot, employeeRecord), { status: 201 });
});
