import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { hydrateEmployee, loadSnapshot } from "@/lib/db/repo";
import { findEmployeeByIdForAuth } from "@/lib/db/invitation-repo";
import { verifySessionValue, type SessionPayload } from "@/lib/session";
import type { EmployeeWithRelations } from "@/types";

export const SESSION_COOKIE = "lms_session";

/** For use in Server Components / layouts. */
export async function getCurrentUser(): Promise<EmployeeWithRelations | null> {
  const store = await cookies();
  return resolveUser(verifySessionValue(store.get(SESSION_COOKIE)?.value));
}

/** For use inside Route Handlers, which receive a NextRequest. */
export async function getCurrentUserFromRequest(request: NextRequest): Promise<EmployeeWithRelations | null> {
  return resolveUser(verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value));
}

async function resolveUser(session: SessionPayload | null): Promise<EmployeeWithRelations | null> {
  if (!session) return null;
  const snapshot = await loadSnapshot();
  const employee = snapshot.employees.find((e) => e.id === session.employeeId);
  if (!employee || employee.status === "INACTIVE") return null;

  // Enforced here rather than by the browser's cookie Max-Age, so a copied cookie value can't be
  // replayed past the configured session length just by ignoring that attribute.
  const maxAgeMs = snapshot.settings.sessionMaxAgeDays * 24 * 60 * 60 * 1000;
  if (Date.now() - session.issuedAt > maxAgeMs) return null;

  // Rejects cookies issued before the employee's last password change — see setEmployeePassword.
  const authRecord = await findEmployeeByIdForAuth(session.employeeId);
  if (!authRecord || authRecord.sessionVersion !== session.sessionVersion) return null;

  return hydrateEmployee(snapshot, employee);
}
