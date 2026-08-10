import { expect, type Page } from "@playwright/test";

/** Fills and submits the set-password form (used for both invite-activation and password-reset
 *  links), waiting for the request itself to finish before returning — the same fix as the login
 *  helper: without it, an immediate follow-up assertion can race ahead of the session actually
 *  being established.
 *
 *  On success, src/app/set-password/page.tsx does `router.push("/")` *after* this request
 *  resolves — a separate, async client-side (soft) navigation. Every caller of this helper
 *  immediately asserts `toHaveURL("/")` afterward, so wait for that navigation to actually land
 *  here once, rather than relying on each call site's own assertion to absorb it.
 *
 *  Deliberately uses `expect(...).toHaveURL()` (a web-first assertion that just polls the frame's
 *  current URL) rather than `page.waitForURL()`. `waitForURL`'s default `waitUntil: "load"` waits
 *  for the browser's `load` event, which a Next.js App Router client-side (soft) navigation does
 *  not reliably re-fire — this was confirmed directly: it produced a clean bimodal result
 *  (near-instant, or the exact 30s timeout, never in between) with the log line "waiting for
 *  navigation to '/' until 'load'". Polling the URL directly has no such lifecycle-event
 *  dependency.
 *
 *  A manual, non-Playwright reproduction of this exact flow completed correctly in well under a
 *  second with zero server errors, while the automated suite intermittently got stuck here for
 *  the entire wait window with the URL never changing at all — not slow, genuinely stuck. That,
 *  together with dozens of "destination stream closed early" server errors correlating with the
 *  stuck runs, traced to a real bug in src/app/set-password/page.tsx: it called `router.push("/")`
 *  immediately followed by `router.refresh()`, and the refresh — firing before React had committed
 *  the push navigation — raced with this page's own Suspense/useSearchParams-driven render. Fixed
 *  at the source by dropping the redundant `router.refresh()` (push() to a new route already
 *  fetches a fresh RSC payload using the just-set session cookie). The timeout here is kept modest
 *  above Playwright's default as ordinary headroom for real server-side rendering work, not to
 *  compensate for that bug. */
export async function submitSetPassword(page: Page, password: string, submitLabel: "Set up account" | "Reset password"): Promise<void> {
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/set-password") && res.request().method() === "POST"),
    page.getByRole("button", { name: submitLabel }).click(),
  ]);
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}
