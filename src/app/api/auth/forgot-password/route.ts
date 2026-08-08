import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api-response";
import { findEmployeeByEmailForAuth } from "@/lib/db/invitation-repo";
import { sendPasswordResetLink } from "@/lib/invitation-service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { withApiHandler } from "@/lib/api-handler";

const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";
const RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Always returns the same response whether or not the account exists (or is eligible) — replying
 * differently would let someone use this endpoint to discover which emails have accounts. The
 * rate limit below is checked the same way regardless of whether the account exists, for the
 * same reason.
 */
export const POST = withApiHandler(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const email = (body?.email as string | undefined)?.trim().toLowerCase();
  if (!email) return errorResponse(400, "email is required.");
  // A format check here is safe (doesn't depend on whether an account exists), unlike
  // everything below it, which must stay indistinguishable regardless of account state.
  if (!z.string().email().safeParse(email).success) return errorResponse(400, "Enter a valid email address.");

  const rateLimitKey = `forgot-password:${getClientIp(request)}:${email}`;
  if (!checkRateLimit(rateLimitKey, RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    // Same generic response even when rate-limited — a distinct error here would itself leak
    // information about request patterns for this email.
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const record = await findEmployeeByEmailForAuth(email);
  // Only send if the account is active and already has a password — a not-yet-invited or
  // deactivated account has no business receiving a reset link.
  if (record && record.status === "ACTIVE" && record.passwordHash) {
    await sendPasswordResetLink(record.id, record.name, record.email);
  }

  return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
});
