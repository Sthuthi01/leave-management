import * as Sentry from "@sentry/nextjs";
import { createToken, findEmployeesNeedingInvite } from "@/lib/db/invitation-repo";
import { INVITE_TOKEN_TTL_HOURS, RESET_TOKEN_TTL_HOURS } from "@/lib/invitation-token";
import { APP_URL, sendInvitationEmail, sendPasswordResetEmail } from "@/lib/email";

/**
 * Generates an invite token and emails it. Used both when HR creates an employee and when HR
 * resends an invitation. Failures are logged but not thrown — a flaky mail server shouldn't roll
 * back employee creation; HR can always use "Resend Invitation" if the email never arrived.
 *
 * Also reported to Sentry (if configured), since a broken SMTP provider would otherwise fail
 * silently for every new hire until someone happens to notice — this is exactly the kind of
 * "critical failure" that should page someone, not just sit in a log nobody's watching.
 */
export async function inviteEmployee(employeeId: string, name: string, email: string): Promise<void> {
  try {
    const { rawToken } = await createToken(employeeId, "INVITE");
    const link = `${APP_URL}/set-password?token=${rawToken}`;
    await sendInvitationEmail({ to: email, name, link, expiresInHours: INVITE_TOKEN_TTL_HOURS });
  } catch (err) {
    // Logged by employee ID, not email address — the email itself is personal data that doesn't
    // need to sit in the logs just to identify which send failed.
    console.error(`[invitation] Failed to send invitation for employee ${employeeId}:`, err);
    Sentry.captureException(err, { tags: { context: "invitation-email" } });
  }
}

/**
 * Generates a reset token and emails it — the same RESET-purpose primitive the self-service
 * "Forgot password" flow uses, just triggered by HR Admin on a specific employee instead of by
 * the user themselves. Consumed by the same /set-password page and endpoint either way.
 */
export async function sendPasswordResetLink(employeeId: string, name: string, email: string): Promise<void> {
  try {
    const { rawToken } = await createToken(employeeId, "RESET");
    const link = `${APP_URL}/set-password?token=${rawToken}`;
    await sendPasswordResetEmail({ to: email, name, link, expiresInHours: RESET_TOKEN_TTL_HOURS });
  } catch (err) {
    console.error(`[password-reset] Failed to send reset link for employee ${employeeId}:`, err);
    Sentry.captureException(err, { tags: { context: "password-reset-email" } });
  }
}

/**
 * Safety net run once at startup (see ensureReady() in src/lib/db/client.ts): finds any active
 * employee left without a password and no live pending invite (e.g. legacy data from before this
 * password feature existed), and sends them a real invitation — never a known/shared password.
 * Idempotent: an employee with an unexpired, unused invite already pending is skipped, so this
 * doesn't re-send an email on every server restart.
 */
export async function inviteEmployeesMissingPassword(): Promise<void> {
  const employees = await findEmployeesNeedingInvite();
  for (const employee of employees) {
    await inviteEmployee(employee.id, employee.name, employee.email);
  }
}
