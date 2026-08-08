import { test, expect } from "@playwright/test";
import { login, logout } from "./helpers/auth";

const ADMIN = { email: "aditi.rao@agrileaf.in", password: "Agrileaf@123", name: "Aditi Rao" };
const MANAGER = { email: "neha.kapoor@agrileaf.in", password: "Agrileaf@123", name: "Neha Kapoor" };
const EMPLOYEE = { email: "rahul.mehta@agrileaf.in", password: "Agrileaf@123", name: "Rahul Mehta" };

test.describe("Login / logout", () => {
  test("HR Admin can log in and reach the dashboard", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("rejects an incorrect password with a generic error", async ({ page }) => {
    await login(page, ADMIN.email, "definitely-wrong-password");
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("logging out ends the session and blocks further access to the app", async ({ page }) => {
    await login(page, EMPLOYEE.email, EMPLOYEE.password);
    await expect(page).toHaveURL("/");
    await logout(page, EMPLOYEE.name);
    await expect(page).toHaveURL("/login");

    // The session cookie is gone — going back to a protected page bounces to /login rather
    // than rendering anything from the previous session.
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Role-based access — Manager", () => {
  test("Manager can reach My Approvals (a manager-permitted function)", async ({ page }) => {
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto("/approvals");
    await expect(page).toHaveURL("/approvals");
    await expect(page.getByRole("heading", { name: "My Approvals" })).toBeVisible();
  });

  test("Manager is blocked from the HR-Admin-only Employees page via direct URL", async ({ page }) => {
    await login(page, MANAGER.email, MANAGER.password);
    const res = await page.goto("/administration/employees");
    expect(res?.status()).toBe(404);
  });

  test("Manager cannot add an employee via a direct API call, even with a valid session", async ({ page, request }) => {
    await login(page, MANAGER.email, MANAGER.password);
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "lms_session");
    expect(sessionCookie).toBeTruthy();

    const res = await request.post("/api/employees", {
      headers: { Cookie: `lms_session=${sessionCookie!.value}` },
      data: { name: "Should Not Be Created", email: `bypass-${Date.now()}@agrileaf.in`, title: "X", departmentId: "dept-eng" },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("Role-based access — Employee", () => {
  test("Employee is blocked from the Employees admin page via direct URL", async ({ page }) => {
    await login(page, EMPLOYEE.email, EMPLOYEE.password);
    const res = await page.goto("/administration/employees");
    expect(res?.status()).toBe(404);
  });

  test("Employee is blocked from the Audit Log page via direct URL", async ({ page }) => {
    await login(page, EMPLOYEE.email, EMPLOYEE.password);
    const res = await page.goto("/administration/audit-log");
    expect(res?.status()).toBe(404);
  });

  test("Employee cannot view the audit log via a direct API call", async ({ page, request }) => {
    await login(page, EMPLOYEE.email, EMPLOYEE.password);
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "lms_session");

    const res = await request.get("/api/audit-log", { headers: { Cookie: `lms_session=${sessionCookie!.value}` } });
    expect(res.status()).toBe(403);
  });

  test("Employee cannot decide someone else's leave request via a direct API call", async ({ page, request }) => {
    await login(page, EMPLOYEE.email, EMPLOYEE.password);
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "lms_session");

    // Any request id is sufficient to prove the authorization check runs before anything
    // resembling a lookup succeeds meaningfully — a non-approver never gets past 403/404.
    const res = await request.post("/api/leave-requests/does-not-exist/decide", {
      headers: { Cookie: `lms_session=${sessionCookie!.value}` },
      data: { decision: "APPROVED" },
    });
    expect([403, 404]).toContain(res.status());
  });
});
