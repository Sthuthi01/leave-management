import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSessionValue } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { hydrateEmployee, loadSnapshot } from "@/lib/db/repo";
import { findEmployeeByEmailForAuth } from "@/lib/db/invitation-repo";
import { verifyPassword } from "@/lib/password";
import { isRateLimited, recordFailedAttempt, clearRateLimit, getClientIp } from "@/lib/rate-limit";
import { withApiHandler } from "@/lib/api-handler";

const INVALID_CREDENTIALS = "Invalid email or password.";
const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Not a real credential for any account — a syntactically valid but meaningless scrypt hash,
// compared against only when no matching employee exists, purely so that path takes roughly the
// same time as a real password check. Without this, an unknown email returns instantly while a
// known one takes as long as a scrypt computation, letting response time alone reveal which
// emails have accounts despite the identical error message.
const DUMMY_PASSWORD_HASH =
  "e381bbee723178387f87eec6ca9a268f:0a315e5fee8a5149f68e734442a1c6c7595c7aa2e7eaa549526428ada5257fb5648a6d78f52ecb616f1fed279fcba893610090020ada6fdd2f6d961b39df101f";

export const POST = withApiHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const email = (body?.email as string | undefined)?.trim().toLowerCase();
  const password = body?.password as string | undefined;
  if (!email || !password) return errorResponse(400, "email and password are required.");

  // Keyed by IP+email so a run of wrong-password guesses against one account gets blocked
  // without penalizing everyone else, or blocking this same account's next *correct* login —
  // only failures count toward this (see below), so logging in successfully many times in a
  // row (a real user, or an automated test) never trips it.
  const rateLimitKey = `login:${getClientIp(request)}:${email}`;
  if (isRateLimited(rateLimitKey, RATE_LIMIT)) {
    return errorResponse(429, "Too many login attempts. Please wait a few minutes and try again.");
  }

  const record = await findEmployeeByEmailForAuth(email);
  // Same generic message whether the email is unknown or the password is wrong — telling them
  // apart would let someone probe which emails have accounts.
  if (!record) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    recordFailedAttempt(rateLimitKey, RATE_LIMIT_WINDOW_MS);
    return errorResponse(401, INVALID_CREDENTIALS);
  }
  if (record.status === "INACTIVE") return errorResponse(403, "This account has been deactivated.");
  if (!record.passwordHash) {
    return errorResponse(403, "This account hasn't been activated yet. Check your email for an invitation, or ask HR to resend it.");
  }
  if (!(await verifyPassword(password, record.passwordHash))) {
    recordFailedAttempt(rateLimitKey, RATE_LIMIT_WINDOW_MS);
    return errorResponse(401, INVALID_CREDENTIALS);
  }
  clearRateLimit(rateLimitKey);

  const snapshot = await loadSnapshot();
  const employee = snapshot.employees.find((e) => e.id === record.id);
  if (!employee) return errorResponse(401, INVALID_CREDENTIALS);

  const store = await cookies();
  store.set(SESSION_COOKIE, signSessionValue(employee.id, record.sessionVersion), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * snapshot.settings.sessionMaxAgeDays,
  });

  return NextResponse.json(hydrateEmployee(snapshot, employee));
});
