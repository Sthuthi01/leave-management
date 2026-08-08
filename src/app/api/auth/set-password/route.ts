import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSessionValue } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { hydrateEmployee, loadSnapshot, logAudit } from "@/lib/db/repo";
import { checkToken, consumeToken, setEmployeePassword } from "@/lib/db/invitation-repo";
import { hashPassword, passwordSchema } from "@/lib/password";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { withApiHandler } from "@/lib/api-handler";

const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const REASON_MESSAGES: Record<string, string> = {
  INVALID: "This link isn't valid. Please check the link or ask for a new one.",
  EXPIRED: "This link has expired. Please ask for a new one.",
  USED: "This link has already been used. If you've already set your password, sign in below.",
};

/** Read-only check the set-password page uses on load, before the user has typed anything. */
export const GET = withApiHandler(async (request: NextRequest) => {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ valid: false, reason: "INVALID", message: REASON_MESSAGES.INVALID });

  const result = await checkToken(token);
  if (result.status !== "VALID") {
    return NextResponse.json({ valid: false, reason: result.status, message: REASON_MESSAGES[result.status] });
  }
  return NextResponse.json({ valid: true, purpose: result.purpose, name: result.employeeName, email: result.employeeEmail });
});

export const POST = withApiHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const token = body?.token as string | undefined;
  const password = body?.password as string | undefined;
  if (!token || !password) return errorResponse(400, "token and password are required.");

  const rateLimitKey = `set-password:${getClientIp(request)}`;
  if (!checkRateLimit(rateLimitKey, RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return errorResponse(429, "Too many attempts. Please wait a few minutes and try again.");
  }

  const strength = passwordSchema.safeParse(password);
  if (!strength.success) return errorResponse(400, strength.error.issues[0]?.message ?? "Password is too weak.");

  const result = await consumeToken(token);
  if (result.status !== "VALID") {
    return errorResponse(410, REASON_MESSAGES[result.status] ?? "This link can no longer be used.");
  }

  const passwordHash = await hashPassword(password);
  const sessionVersion = await setEmployeePassword(result.employeeId, passwordHash);
  await logAudit(
    { id: result.employeeId, name: result.employeeName },
    result.purpose === "INVITE" ? "Activated account" : "Reset password",
    "Employee",
    result.employeeName
  );

  // Sign the user straight in — no reason to make them re-enter the password they just chose.
  const snapshot = await loadSnapshot();
  const employee = snapshot.employees.find((e) => e.id === result.employeeId);
  if (!employee) return errorResponse(500, "Something went wrong. Please try signing in.");

  const store = await cookies();
  store.set(SESSION_COOKIE, signSessionValue(employee.id, sessionVersion), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * snapshot.settings.sessionMaxAgeDays,
  });

  return NextResponse.json(hydrateEmployee(snapshot, employee));
});
