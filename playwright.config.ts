import { defineConfig, devices } from "@playwright/test";

// Runs against the local dev stack (docker-compose.yml — app + Mailpit) rather than starting
// its own server, so it exercises the exact same build/config path a developer runs day to
// day. Start the stack first: `docker compose up -d`.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
