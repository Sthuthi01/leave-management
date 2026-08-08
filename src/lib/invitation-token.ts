import crypto from "crypto";

export const INVITE_TOKEN_TTL_HOURS = 48;
export const RESET_TOKEN_TTL_HOURS = 1;

/** A random, URL-safe, single-use token — this is the value put in the emailed link. */
export function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Only this hash is ever stored in the database. Hashing (rather than storing the raw token) means
 * a database leak alone can't be used to set someone's password — the attacker would still need the
 * original token from the email itself. SHA-256 (not a slow password hash) is appropriate here since
 * the input is already 256 bits of high-entropy randomness, not a guessable human password.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
