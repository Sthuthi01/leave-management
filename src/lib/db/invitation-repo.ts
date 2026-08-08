import { randomUUID } from "crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, ensureReady } from "./client";
import * as schema from "./schema";
import { generateRawToken, hashToken, INVITE_TOKEN_TTL_HOURS, RESET_TOKEN_TTL_HOURS } from "@/lib/invitation-token";

export type TokenPurpose = "INVITE" | "RESET";

export interface EmployeeAuthRecord {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  passwordHash: string | null;
  sessionVersion: number;
}

const AUTH_COLUMNS = {
  id: schema.employees.id,
  name: schema.employees.name,
  email: schema.employees.email,
  status: schema.employees.status,
  passwordHash: schema.employees.passwordHash,
  sessionVersion: schema.employees.sessionVersion,
};

/**
 * These two lookups are the only queries in the app that select `password_hash` — kept in this
 * file, used only for verifying credentials (login, change/reset password), never returned as-is
 * to a client. Every other read path goes through repo.ts's loadSnapshot(), which deliberately
 * excludes this column.
 */
export async function findEmployeeByEmailForAuth(email: string): Promise<EmployeeAuthRecord | undefined> {
  await ensureReady();
  const [row] = await db.select(AUTH_COLUMNS).from(schema.employees).where(eq(schema.employees.email, email)).limit(1);
  return row;
}

export async function findEmployeeByIdForAuth(id: string): Promise<EmployeeAuthRecord | undefined> {
  await ensureReady();
  const [row] = await db.select(AUTH_COLUMNS).from(schema.employees).where(eq(schema.employees.id, id)).limit(1);
  return row;
}

/**
 * Also bumps session_version, invalidating every session cookie issued before this call (see
 * SessionPayload/verifySessionValue in session.ts) — a stolen cookie stops working the moment the
 * real owner changes their password. Returns the new version so the caller can immediately sign a
 * fresh cookie for the request that triggered this change, rather than logging that request out too.
 */
export async function setEmployeePassword(employeeId: string, passwordHash: string): Promise<number> {
  await ensureReady();
  const [row] = await db
    .update(schema.employees)
    .set({ passwordHash, sessionVersion: sql`${schema.employees.sessionVersion} + 1` })
    .where(eq(schema.employees.id, employeeId))
    .returning({ sessionVersion: schema.employees.sessionVersion });
  return row.sessionVersion;
}

/**
 * Active employees with no password set and no currently-valid pending invitation — i.e. anyone
 * who'd otherwise be locked out with no way in. Used to self-heal legacy data (e.g. employees
 * that existed before this password feature shipped) by sending them a real invitation, instead
 * of ever assigning a known/shared password.
 */
// No ensureReady() guard here — this is called from within initialize() itself (see
// inviteEmployeesMissingPassword, invoked by client.ts's initialize() as part of the same
// __leaflowReady promise this would otherwise await, which would deadlock startup forever).
export async function findEmployeesNeedingInvite(): Promise<EmployeeAuthRecord[]> {
  const candidates = await db
    .select(AUTH_COLUMNS)
    .from(schema.employees)
    .where(and(eq(schema.employees.status, "ACTIVE"), isNull(schema.employees.passwordHash)));
  if (candidates.length === 0) return [];

  const pending = await db
    .select({ employeeId: schema.passwordSetupTokens.employeeId })
    .from(schema.passwordSetupTokens)
    .where(
      and(
        eq(schema.passwordSetupTokens.purpose, "INVITE"),
        isNull(schema.passwordSetupTokens.usedAt),
        gt(schema.passwordSetupTokens.expiresAt, new Date())
      )
    );
  const pendingIds = new Set(pending.map((p) => p.employeeId));
  return candidates.filter((c) => !pendingIds.has(c.id));
}

const TTL_HOURS: Record<TokenPurpose, number> = { INVITE: INVITE_TOKEN_TTL_HOURS, RESET: RESET_TOKEN_TTL_HOURS };

/**
 * Issues a fresh token, first invalidating any prior unused token of the same purpose for this
 * employee — so "Resend Invitation" (or requesting a second password reset) can't leave multiple
 * valid links floating around. Returns the raw token to email; only its hash is ever stored.
 */
export async function createToken(employeeId: string, purpose: TokenPurpose): Promise<{ rawToken: string; expiresAt: Date }> {
  const now = new Date();
  await db
    .update(schema.passwordSetupTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.passwordSetupTokens.employeeId, employeeId),
        eq(schema.passwordSetupTokens.purpose, purpose),
        isNull(schema.passwordSetupTokens.usedAt)
      )
    );

  const rawToken = generateRawToken();
  const expiresAt = new Date(now.getTime() + TTL_HOURS[purpose] * 60 * 60 * 1000);
  await db.insert(schema.passwordSetupTokens).values({
    id: randomUUID(),
    employeeId,
    tokenHash: hashToken(rawToken),
    purpose,
    expiresAt,
    usedAt: null,
    createdAt: now,
  });

  return { rawToken, expiresAt };
}

export type TokenCheckResult =
  | { status: "VALID"; employeeId: string; employeeName: string; employeeEmail: string; purpose: TokenPurpose }
  | { status: "INVALID" | "EXPIRED" | "USED" };

/**
 * Read-only check, used to decide what the set-password page should render before the user has
 * typed anything. Does not consume the token, so loading the page (or a chat client's link
 * preview fetching it) can't burn a one-time link on its own.
 */
export async function checkToken(rawToken: string): Promise<TokenCheckResult> {
  await ensureReady();
  const tokenHash = hashToken(rawToken);
  const [row] = await db
    .select({
      employeeId: schema.passwordSetupTokens.employeeId,
      purpose: schema.passwordSetupTokens.purpose,
      expiresAt: schema.passwordSetupTokens.expiresAt,
      usedAt: schema.passwordSetupTokens.usedAt,
      employeeName: schema.employees.name,
      employeeEmail: schema.employees.email,
      employeeStatus: schema.employees.status,
    })
    .from(schema.passwordSetupTokens)
    .innerJoin(schema.employees, eq(schema.employees.id, schema.passwordSetupTokens.employeeId))
    .where(eq(schema.passwordSetupTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.employeeStatus === "INACTIVE") return { status: "INVALID" };
  if (row.usedAt) return { status: "USED" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "EXPIRED" };
  return { status: "VALID", employeeId: row.employeeId, employeeName: row.employeeName, employeeEmail: row.employeeEmail, purpose: row.purpose };
}

/**
 * Validates and atomically marks a token used in a single `UPDATE ... WHERE used_at IS NULL
 * RETURNING`, so two concurrent submissions of the same link (e.g. a double-click) can't both
 * succeed.
 */
export async function consumeToken(rawToken: string): Promise<TokenCheckResult> {
  const check = await checkToken(rawToken);
  if (check.status !== "VALID") return check;

  const [updated] = await db
    .update(schema.passwordSetupTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.passwordSetupTokens.tokenHash, hashToken(rawToken)), isNull(schema.passwordSetupTokens.usedAt)))
    .returning({ id: schema.passwordSetupTokens.id });

  if (!updated) return { status: "USED" };
  return check;
}
