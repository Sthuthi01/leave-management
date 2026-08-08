import crypto from "crypto";

const INSECURE_DEFAULT = "leaflow-dev-insecure-default-secret-change-me";
let warnedInsecureDefault = false;

/**
 * Read lazily, on first actual use, rather than at module load. `next build` statically imports
 * every route module (including this one, transitively) with no runtime secrets available — an
 * eager check here would make production Docker builds fail even though the running container
 * will have SESSION_SECRET set. See the identical pattern (and reasoning) for DATABASE_URL in
 * src/lib/db/client.ts.
 */
function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not set. Refusing to sign or verify session cookies with an insecure default in production. Set SESSION_SECRET in your environment (generate one with: openssl rand -hex 32)."
    );
  }
  if (!warnedInsecureDefault) {
    console.warn(
      "[auth] SESSION_SECRET is not set — using an insecure default. Set SESSION_SECRET in your environment before deploying this app anywhere but your own machine."
    );
    warnedInsecureDefault = true;
  }
  return INSECURE_DEFAULT;
}

export interface SessionPayload {
  employeeId: string;
  /** ms since epoch when this cookie was signed — lets the caller enforce the configured session
   *  length server-side, rather than trusting the browser to honor the cookie's Max-Age. */
  issuedAt: number;
  /** The employee's session_version at signing time — see setEmployeePassword in
   *  invitation-repo.ts, which bumps it on every password change. */
  sessionVersion: number;
}

/** Signs an employee id, issue time, and session version so the session cookie can't be forged,
 *  replayed past its configured lifetime, or reused after the account's password changes. */
export function signSessionValue(employeeId: string, sessionVersion: number): string {
  const issuedAt = Date.now();
  const payload = `${employeeId}.${issuedAt}.${sessionVersion}`;
  const signature = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/**
 * Verifies a signed session cookie value's signature and shape. Deliberately does NOT check
 * expiry or session-version freshness here — this module has no access to the app's configured
 * session length or the employee's current session_version, both of which live in the database.
 * Callers (see resolveUser in auth.ts) must check both against the returned payload.
 */
export function verifySessionValue(value: string | undefined | null): SessionPayload | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length < 4) return null;

  // employeeId itself could in principle contain a dot, so peel the three known-fixed-format
  // fields off the end rather than assuming a fixed split count.
  const signature = parts.pop()!;
  const sessionVersionRaw = parts.pop()!;
  const issuedAtRaw = parts.pop()!;
  const employeeId = parts.join(".");

  const issuedAt = Number(issuedAtRaw);
  const sessionVersion = Number(sessionVersionRaw);
  if (!employeeId || !Number.isFinite(issuedAt) || !Number.isInteger(sessionVersion)) return null;

  const payload = `${employeeId}.${issuedAtRaw}.${sessionVersionRaw}`;
  const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");

  const provided = Buffer.from(signature, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) {
    return null;
  }
  return { employeeId, issuedAt, sessionVersion };
}
