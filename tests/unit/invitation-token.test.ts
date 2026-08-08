import { describe, expect, it } from "vitest";
import { generateRawToken, hashToken, INVITE_TOKEN_TTL_HOURS, RESET_TOKEN_TTL_HOURS } from "@/lib/invitation-token";

describe("generateRawToken", () => {
  it("generates a URL-safe token with no padding or reserved characters", () => {
    const token = generateRawToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token on every call", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateRawToken()));
    expect(tokens.size).toBe(20);
  });

  it("generates enough entropy that it isn't practically guessable (32 bytes)", () => {
    // base64url-encodes 32 bytes to 43 characters (no padding).
    expect(generateRawToken().length).toBe(43);
  });
});

describe("hashToken", () => {
  it("is deterministic for the same input", () => {
    const token = generateRawToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("produces a different hash for a different token", () => {
    expect(hashToken(generateRawToken())).not.toBe(hashToken(generateRawToken()));
  });

  it("never returns the raw token itself", () => {
    const token = generateRawToken();
    expect(hashToken(token)).not.toBe(token);
  });

  it("produces a 64-character hex SHA-256 digest", () => {
    expect(hashToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("token TTLs", () => {
  it("gives invitations a longer window than password resets", () => {
    // Invites need to survive someone being slow to check email after onboarding; resets are
    // shorter-lived since they're requested in-the-moment and are more sensitive to reuse.
    expect(INVITE_TOKEN_TTL_HOURS).toBeGreaterThan(RESET_TOKEN_TTL_HOURS);
  });
});
