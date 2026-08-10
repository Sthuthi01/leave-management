import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers/auth";
import { waitForSetPasswordLink } from "./helpers/mailpit";
import { submitSetPassword } from "./helpers/set-password";

const ADMIN = { email: "aditi.rao@agrileaf.in", password: "Agrileaf@123" };

/** Provisions a throwaway, fully-activated employee to reset the password of, rather than
 *  touching any shared demo account's credentials. */
async function createActivatedEmployee(page: import("@playwright/test").Page) {
  const stamp = Date.now();
  const name = `E2E Reset Subject ${stamp}`;
  const email = `e2e.reset.${stamp}@agrileaf.in`;
  const sentAfter = new Date();

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/administration/employees");
  await page.getByRole("button", { name: "Add employee" }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Job title").fill("E2E Test Engineer");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Engineering" }).click();
  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByText("Employee added")).toBeVisible();

  const inviteLink = await waitForSetPasswordLink(email, "invited", sentAfter);
  await page.goto(inviteLink);
  await submitSetPassword(page, "OriginalPass123", "Set up account");
  await expect(page).toHaveURL("/");

  return { name, email };
}

test("Forgot password: a user resets their own password and can log in with the new one", async ({ page }) => {
  const { name, email } = await createActivatedEmployee(page);
  await logout(page, name);

  const sentAfter = new Date();
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  // Forgot password? is a client-side (soft) navigation — wait for it to actually land before
  // interacting, or a fast fill() can hit the outgoing /login page's own Email field instead of
  // the new one's. Uses the web-first `expect(...).toHaveURL()` rather than `page.waitForURL()`:
  // the latter's default `waitUntil: "load"` doesn't reliably re-fire for a Next.js App Router
  // soft navigation (see tests/e2e/helpers/set-password.ts for the same issue, confirmed there).
  await expect(page).toHaveURL("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/we've sent a link to reset your password/i)).toBeVisible();

  const resetLink = await waitForSetPasswordLink(email, "Reset", sentAfter);
  await page.goto(resetLink);
  await expect(page.getByText("Reset your password")).toBeVisible();
  await submitSetPassword(page, "BrandNewPass456", "Reset password");
  await expect(page).toHaveURL("/");
  await logout(page, name);

  // The old password no longer works...
  await login(page, email, "OriginalPass123");
  await expect(page.getByText("Invalid email or password.")).toBeVisible();

  // ...but the new one does.
  await login(page, email, "BrandNewPass456");
  await expect(page).toHaveURL("/");
});

test("Forgot password does not reveal whether an email is registered", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("definitely.not.a.real.user@agrileaf.in");
  await page.getByRole("button", { name: "Send reset link" }).click();
  // Same generic confirmation regardless of whether the account exists.
  await expect(page.getByText(/we've sent a link to reset your password/i)).toBeVisible();
});

test("Change password (while signed in) takes effect immediately", async ({ page }) => {
  const { name, email } = await createActivatedEmployee(page);

  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  await page.getByLabel("Current password").fill("OriginalPass123");
  await page.getByLabel("New password", { exact: true }).fill("ChangedPass789");
  await page.getByLabel("Confirm new password").fill("ChangedPass789");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed.")).toBeVisible();

  await logout(page, name);
  await login(page, email, "ChangedPass789");
  await expect(page).toHaveURL("/");
});
