import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password against its own hash", async () => {
    const hash = await hashPassword("CorrectHorse123");
    expect(await verifyPassword("CorrectHorse123", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("CorrectHorse123");
    expect(await verifyPassword("WrongPassword456", hash)).toBe(false);
  });

  it("never stores the plaintext password in the hash", async () => {
    const hash = await hashPassword("CorrectHorse123");
    expect(hash).not.toContain("CorrectHorse123");
  });

  it("produces a different hash each time due to a random salt", async () => {
    const hashA = await hashPassword("SamePassword789");
    const hashB = await hashPassword("SamePassword789");
    expect(hashA).not.toBe(hashB);
    // Both must still verify correctly despite differing.
    expect(await verifyPassword("SamePassword789", hashA)).toBe(true);
    expect(await verifyPassword("SamePassword789", hashB)).toBe(true);
  });

  it("stores the hash as salt:hash hex", () => {
    return hashPassword("CorrectHorse123").then((hash) => {
      expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    });
  });

  it("rejects gracefully against a malformed stored value", async () => {
    expect(await verifyPassword("anything", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});
