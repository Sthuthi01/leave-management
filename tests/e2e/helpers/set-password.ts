import type { Page } from "@playwright/test";

/** Fills and submits the set-password form (used for both invite-activation and password-reset
 *  links), waiting for the request itself to finish before returning — the same fix as the login
 *  helper: without it, an immediate follow-up assertion can race ahead of the session actually
 *  being established. */
export async function submitSetPassword(page: Page, password: string, submitLabel: "Set up account" | "Reset password"): Promise<void> {
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/set-password") && res.request().method() === "POST"),
    page.getByRole("button", { name: submitLabel }).click(),
  ]);
}
