import { defineConfig, devices } from "@playwright/test";

// Runs against the local dev stack (docker-compose.yml — app + Mailpit) rather than starting
// its own server, so it exercises the exact same build/config path a developer runs day to
// day. Start the stack first: `docker compose up -d`.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  // Slightly above the 30s default as headroom for the slowest step in this suite (the
  // set-password → dashboard navigation, which does real server-side rendering), not to paper
  // over any known issue — see the note on submitSetPassword in tests/e2e/helpers/set-password.ts
  // for the actual bug that used to live here (fixed at the source, in application code).
  timeout: 45_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
