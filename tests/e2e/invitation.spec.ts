import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";
import { waitForSetPasswordLink } from "./helpers/mailpit";
import { submitSetPassword } from "./helpers/set-password";

const ADMIN = { email: "aditi.rao@agrileaf.in", password: "Agrileaf@123" };

test("HR Admin invites a new employee, who sets their own password and is signed in", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Invitee ${stamp}`;
  const email = `e2e.invitee.${stamp}@agrileaf.in`;
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

  // HR never sets or sees a password for the new account — the toast confirms an email went
  // out instead, and the row shows Invitation Pending, not any password field.
  await expect(page.getByText("Employee added")).toBeVisible();
  const row = page.locator("tr", { hasText: email }).or(page.locator("tr", { hasText: name }));
  await expect(row.getByText("Invitation Pending")).toBeVisible();

  const link = await waitForSetPasswordLink(email, "invited", sentAfter);

  await page.goto(link);
  await expect(page.getByText("Set up your account")).toBeVisible();
  await submitSetPassword(page, "E2ETestPass123", "Set up account");

  // Consuming the invite signs them straight in — no second login step.
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Confirm from the admin's side too: the account now shows Active, not Invitation Pending.
  // The table shows the employee's name, not their email, so filter/match on name.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/administration/employees");
  await page.getByPlaceholder("Search by name, email, title...").fill(name);
  await expect(page.locator("tr", { hasText: name }).getByText("Active", { exact: true })).toBeVisible();
});

test("A used invitation link cannot be used a second time", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Reuse ${stamp}`;
  const email = `e2e.reuse.${stamp}@agrileaf.in`;
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

  const link = await waitForSetPasswordLink(email, "invited", sentAfter);
  await page.goto(link);
  await submitSetPassword(page, "E2ETestPass123", "Set up account");
  await expect(page).toHaveURL("/");

  // Re-visiting the same link after it's already been consumed must fail gracefully.
  await page.goto(link);
  await expect(page.getByText(/already been used/i)).toBeVisible();
});
