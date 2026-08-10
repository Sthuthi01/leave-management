/**
 * One-time local bootstrap: creates the first HR Admin so a fresh clone doesn't need any manual
 * database editing. There's no in-app way to do this — every employee-creation path requires an
 * already-authenticated ADMIN, which a brand-new database doesn't have (see POST /api/employees).
 *
 * Deliberately NOT part of the running app: it lives outside src/, isn't traced by Next's
 * bundler, and the Docker image (dev and prod both build the same minimal `runner` stage — see
 * Dockerfile) never contains this file or the devDependencies (tsx) needed to run it. It can only
 * be invoked from a developer's own machine, in a real git checkout — never inside the deployed
 * app container, and never in UAT/production.
 *
 * Usage (run on your host machine, with the local Docker stack already up):
 *   npm run bootstrap-admin -- --name "Priya Sharma" --email "priya@example.com"
 *   npm run bootstrap-admin                              (prompts interactively instead)
 */

import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";

// Loaded manually (not via a Node/Next built-in) so this works the same across whatever Node
// version a developer happens to have — next/tsx don't auto-load .env outside `next dev|build|start`.
function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Never override a value the shell/CI already provided explicitly.
    if (key && process.env[key] === undefined) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}
loadDotEnv();

// src/lib/email.ts has no built-in SMTP fallback — "mailpit" as a default only exists inside
// docker-compose.yml's env injection for the containerized app, which this script isn't. Applied
// only to this process's own env (never written back to .env), so the containerized app's real
// config — which correctly points at the Docker-internal "mailpit" host — is never touched.
if (!process.env.SMTP_HOST) {
  process.env.SMTP_HOST = "localhost";
  process.env.SMTP_PORT ??= "1025";
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run: NODE_ENV=production. This script is for local development only.");
    process.exit(1);
  }

  // Imported after the env setup above, and inside main() rather than at module scope, so
  // src/lib/db/client.ts (which reads DATABASE_URL/SMTP_HOST at import time in some cases) always
  // sees the values this script just set.
  const { z } = await import("zod");
  const { db, ensureReady } = await import("../src/lib/db/client");
  const { departments, employees } = await import("../src/lib/db/schema");
  const { insertDepartment, insertEmployee, logAudit } = await import("../src/lib/db/repo");
  const { inviteEmployee } = await import("../src/lib/invitation-service");

  await ensureReady(); // runs pending migrations first, same as the app itself does on startup

  const [existingAdmin] = await db.select().from(employees).where(eq(employees.role, "ADMIN")).limit(1);
  if (existingAdmin) {
    console.error(`Refusing to run: an HR Admin already exists (${existingAdmin.name} <${existingAdmin.email}>).`);
    console.error('Sign in as that admin and use "Add employee" in the app to create additional accounts.');
    process.exit(1);
  }

  const args = parseArgs();
  const name = (args.name ?? (await prompt("HR Admin full name: "))).trim();
  const email = (args.email ?? (await prompt("HR Admin email address: "))).trim().toLowerCase();

  if (!name) {
    console.error("A name is required.");
    process.exit(1);
  }
  if (!z.string().email().safeParse(email).success) {
    console.error("That doesn't look like a valid email address.");
    process.exit(1);
  }

  const [existingByEmail] = await db.select().from(employees).where(eq(employees.email, email)).limit(1);
  if (existingByEmail) {
    console.error(`An employee with email ${email} already exists.`);
    process.exit(1);
  }

  let [department] = await db.select().from(departments).limit(1);
  if (!department) {
    department = { id: "dept-general", name: "General" };
    await insertDepartment(department);
    console.log(`No department existed yet — created a placeholder department "${department.name}".`);
  }

  const employee = {
    id: `emp-${Date.now()}`,
    name,
    email,
    avatarUrl: null,
    role: "ADMIN" as const,
    title: "HR Administrator",
    departmentId: department.id,
    managerId: null,
    joinedAt: new Date().toISOString().slice(0, 10),
    status: "ACTIVE" as const,
    onboardingChecklistId: null,
  };
  // passwordHash is intentionally never set here — left NULL, exactly like a normal
  // HR-created employee, until the recipient sets it themselves via the emailed link below.
  await insertEmployee(employee);
  await logAudit(
    { id: "system-bootstrap", name: "Local bootstrap script" },
    "Bootstrapped first HR Admin",
    "Employee",
    employee.name,
    `Invitation sent to ${employee.email}`
  );
  await inviteEmployee(employee.id, employee.name, employee.email);

  console.log(`\nCreated HR Admin "${name}" <${email}>.`);
  console.log("An invitation email was sent — open Mailpit at http://localhost:8025 to set the password.");
  process.exit(0);
}

function parseArgs(): { name?: string; email?: string } {
  const args = process.argv.slice(2);
  const out: { name?: string; email?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name") out.name = args[++i];
    else if (args[i] === "--email") out.email = args[++i];
  }
  return out;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
