import type { Page } from "@playwright/test";

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  // Wait for the login request itself to finish (not just the click) — otherwise a caller that
  // immediately navigates elsewhere can race ahead of the session cookie actually being set.
  // Works for both success and failure: the response resolves either way; only the success path
  // then goes on to redirect client-side.
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/login") && res.request().method() === "POST"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

/** Opens the user menu (top-right, identified by the signed-in user's own name) and signs out. */
export async function logout(page: Page, userName: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(userName) }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}
