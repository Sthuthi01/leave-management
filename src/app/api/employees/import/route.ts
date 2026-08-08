import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { insertEmployee, loadSnapshot, logAudit } from "@/lib/db/repo";
import { checklistExists } from "@/lib/db/onboarding-repo";
import { inviteEmployee } from "@/lib/invitation-service";
import { withApiHandler } from "@/lib/api-handler";
import type { Role } from "@/types";

const MAX_ROWS = 500;
const VALID_ROLES: Role[] = ["EMPLOYEE", "MANAGER", "ADMIN"];

interface ImportRowInput {
  name?: string;
  email?: string;
  title?: string;
  departmentId?: string;
  managerId?: string | null;
  role?: Role;
  onboardingChecklistId?: string | null;
}

interface ImportRowResult {
  index: number;
  status: "created" | "skipped";
  message?: string;
}

/**
 * Bulk equivalent of POST /api/employees — re-runs the same per-row checks that route enforces
 * (department/manager/checklist must exist, email must be unique) rather than trusting the
 * client's own validation, since the request body is untrusted input.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");
  if (user.role !== "ADMIN") return errorResponse(403, "Only admins can import employees.");

  const body = await request.json().catch(() => null);
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return errorResponse(400, "rows must be a non-empty array.");
  if (rows.length > MAX_ROWS) return errorResponse(400, `A single import can contain at most ${MAX_ROWS} rows.`);

  const snapshot = await loadSnapshot();
  const results: ImportRowResult[] = [];
  let created = 0;

  for (let index = 0; index < rows.length; index++) {
    const row = (rows[index] ?? {}) as ImportRowInput;
    const name = row.name?.trim();
    const email = row.email?.trim().toLowerCase();
    const title = row.title?.trim();
    const departmentId = row.departmentId;
    const managerId = row.managerId || null;
    const role: Role = row.role && VALID_ROLES.includes(row.role) ? row.role : "EMPLOYEE";
    const onboardingChecklistId = row.onboardingChecklistId || null;

    if (!name || !email || !title || !departmentId) {
      results.push({ index, status: "skipped", message: "Missing required fields." });
      continue;
    }
    if (!snapshot.departments.some((d) => d.id === departmentId)) {
      results.push({ index, status: "skipped", message: "Unknown department." });
      continue;
    }
    if (managerId && !snapshot.employees.some((e) => e.id === managerId)) {
      results.push({ index, status: "skipped", message: "Unknown manager." });
      continue;
    }
    if (snapshot.employees.some((e) => e.email === email)) {
      results.push({ index, status: "skipped", message: "An employee with this email already exists." });
      continue;
    }
    if (onboardingChecklistId && !(await checklistExists(onboardingChecklistId))) {
      results.push({ index, status: "skipped", message: "Unknown onboarding checklist." });
      continue;
    }

    const employee = {
      id: `emp-${Date.now()}-${index}`,
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
    await logAudit(user, "Added employee", "Employee", employee.name);
    snapshot.employees.push({ ...employee, hasPassword: false });
    await inviteEmployee(employee.id, employee.name, employee.email);
    created++;
    results.push({ index, status: "created" });
  }

  return NextResponse.json({ created, skipped: results.length - created, results });
});
