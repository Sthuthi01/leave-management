import { test, expect, type Page } from "@playwright/test";
import { login, logout } from "./helpers/auth";
import { waitForSetPasswordLink } from "./helpers/mailpit";
import { submitSetPassword } from "./helpers/set-password";

const ADMIN = { email: "aditi.rao@agrileaf.in", password: "Agrileaf@123" };
const MANAGER = { email: "neha.kapoor@agrileaf.in", password: "Agrileaf@123", name: "Neha Kapoor" };

/** A throwaway employee reporting to Neha Kapoor, so this test's leave requests can't collide
 *  with any other pending request already in her approval queue. */
async function createEmployeeReportingToNeha(page: Page) {
  const stamp = Date.now();
  const name = `E2E Leave Applicant ${stamp}`;
  const email = `e2e.leave.${stamp}@agrileaf.in`;
  const password = "LeaveTestPass123";
  const sentAfter = new Date();

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/administration/employees");
  await page.getByRole("button", { name: "Add employee" }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Job title").fill("E2E Test Engineer");

  const comboboxes = page.getByRole("combobox");
  await comboboxes.nth(0).click(); // Department
  await page.getByRole("option", { name: "Engineering" }).click();
  await comboboxes.nth(2).click(); // Reporting Manager
  await page.getByRole("option", { name: "Neha Kapoor" }).click();

  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByText("Employee added")).toBeVisible();

  const inviteLink = await waitForSetPasswordLink(email, "invited", sentAfter);
  await page.goto(inviteLink);
  await submitSetPassword(page, password, "Set up account");
  await expect(page).toHaveURL("/");
  await logout(page, name);

  return { name, email, password };
}

function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/** A guaranteed Monday–Friday date, offset just enough to clear the nearest seeded holiday
 *  (Independence Day, 15 Aug) while staying within the current calendar year — leave balances
 *  are tracked per year, so a date that rolled into next year would silently land on a
 *  different balance row than the one the dashboard displays for the current year. A single-day
 *  request on a date like this is unambiguously exactly 1 working day. */
function nextWeekday(minDaysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + minDaysFromNow);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

test("Employee applies for leave, sees it pending, and the balance reflects it once approved", async ({ page }) => {
  const applicant = await createEmployeeReportingToNeha(page);

  // A single guaranteed weekday, far enough out to clear Independence Day (15 Aug) but still
  // well within this calendar year, so it lands on the same year's balance the dashboard shows.
  const date = nextWeekday(30);

  await login(page, applicant.email, applicant.password);

  // Read the starting Casual Leave balance before applying, so the post-approval assertion
  // checks an actual numeric change rather than just a status label.
  await page.goto("/");
  const clCard = page.locator("[data-slot=card]", { hasText: "CL" });
  const beforeText = (await clCard.locator(".text-xl").innerText()).trim();
  const beforeRemaining = Number(beforeText.match(/\d+/)?.[0]);
  expect(Number.isFinite(beforeRemaining)).toBe(true);

  await page.goto("/leave/apply");
  await page.getByRole("combobox").first().click(); // Leave type
  await page.getByRole("option", { name: /Casual Leave/i }).click();
  await page.getByLabel("Start Date").fill(date);
  await page.getByLabel("End Date").fill(date);
  await page.getByLabel("Reason").fill("E2E test leave application");
  await page.getByRole("button", { name: "Submit request" }).click();

  await expect(page.getByText(/submitted/i)).toBeVisible({ timeout: 10_000 });

  // This throwaway employee has never applied for leave before, so their My Leaves table has
  // exactly one row — no need to disambiguate by reason (not shown in this table) or date.
  await page.goto("/leave/my-leaves");
  await expect(page.getByRole("row")).toHaveCount(2); // header row + the one request
  await expect(page.getByRole("table").getByText("Pending", { exact: true })).toBeVisible();

  await logout(page, applicant.name);

  // Manager approves it.
  await login(page, MANAGER.email, MANAGER.password);
  await page.goto("/approvals");
  await page.getByPlaceholder("Search by employee name…").fill(applicant.name);
  await expect(page.getByText(applicant.name)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByText("Leave request approved.")).toBeVisible();

  // From the employee's side, the request now shows Approved...
  await logout(page, MANAGER.name);
  await login(page, applicant.email, applicant.password);
  await page.goto("/leave/my-leaves");
  await expect(page.getByRole("table").getByText("Approved", { exact: true })).toBeVisible();

  // ...and the balance itself dropped by exactly the 1 working day requested — not just a status
  // label, an actual numeric deduction.
  await page.goto("/");
  const afterText = (await clCard.locator(".text-xl").innerText()).trim();
  const afterRemaining = Number(afterText.match(/\d+/)?.[0]);
  expect(afterRemaining).toBe(beforeRemaining - 1);
});

test("Manager rejecting a leave request requires a comment", async ({ page }) => {
  const applicant = await createEmployeeReportingToNeha(page);
  const startDate = isoDate(95);
  const endDate = isoDate(95);

  await login(page, applicant.email, applicant.password);
  await page.goto("/leave/apply");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  await page.getByLabel("Start Date").fill(startDate);
  await page.getByLabel("End Date").fill(endDate);
  await page.getByLabel("Reason").fill("E2E rejection test");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText(/submitted/i)).toBeVisible({ timeout: 10_000 });
  await logout(page, applicant.name);

  await login(page, MANAGER.email, MANAGER.password);
  await page.goto("/approvals");
  await page.getByPlaceholder("Search by employee name…").fill(applicant.name);
  await page.getByRole("button", { name: "Reject" }).click();

  const confirmButton = page.getByRole("button", { name: "Confirm rejection" });
  await expect(confirmButton).toBeDisabled();

  await page.getByLabel(/Comment/).fill("Not enough coverage on the team that week.");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByText("Leave request rejected.")).toBeVisible();
});
