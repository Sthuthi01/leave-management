import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUserFromRequest, SESSION_COOKIE } from "@/lib/auth";
import { signSessionValue } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { findEmployeeByIdForAuth, setEmployeePassword } from "@/lib/db/invitation-repo";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/password";
import { loadSnapshot, logAudit } from "@/lib/db/repo";
import { checkRateLimit } from "@/lib/rate-limit";
import { withApiHandler } from "@/lib/api-handler";

const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export const POST = withApiHandler(async (request: NextRequest) => {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return errorResponse(401, "Not signed in.");

  if (!checkRateLimit(`change-password:${user.id}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return errorResponse(429, "Too many attempts. Please wait a few minutes and try again.");
  }

  const body = await request.json().catch(() => null);
  const currentPassword = body?.currentPassword as string | undefined;
  const newPassword = body?.newPassword as string | undefined;
  if (!currentPassword || !newPassword) return errorResponse(400, "currentPassword and newPassword are required.");

  const strength = passwordSchema.safeParse(newPassword);
  if (!strength.success) return errorResponse(400, strength.error.issues[0]?.message ?? "Password is too weak.");

  const record = await findEmployeeByIdForAuth(user.id);
  if (!record?.passwordHash || !(await verifyPassword(currentPassword, record.passwordHash))) {
    return errorResponse(401, "Current password is incorrect.");
  }

  const sessionVersion = await setEmployeePassword(user.id, await hashPassword(newPassword));
  await logAudit(user, "Changed password", "Employee", user.name);

  // setEmployeePassword bumped session_version, which invalidates every cookie issued before
  // this request — including the one that's making it. Issue a fresh one now so the person who
  // just changed their own password stays signed in; only other, now-stale copies (e.g. a
  // stolen cookie) are locked out.
  const snapshot = await loadSnapshot();
  const store = await cookies();
  store.set(SESSION_COOKIE, signSessionValue(user.id, sessionVersion), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * snapshot.settings.sessionMaxAgeDays,
  });

  return NextResponse.json({ ok: true });
});
