import crypto from "crypto";

export { passwordSchema } from "@/lib/password-rules";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => (err ? reject(err) : resolve(derivedKey)));
  });
}

/** Hashes a plaintext password for storage. Uses Node's built-in scrypt (memory-hard, no extra
 *  dependency) with a random per-password salt, stored alongside the hash as `salt:hash` hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
  const derivedKey = await scryptAsync(password, salt);
  return `${salt}:${derivedKey.toString("hex")}`;
}

/** Verifies a plaintext password against a stored `salt:hash` value in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derivedKey = await scryptAsync(password, salt);
  const hashBuffer = Buffer.from(hash, "hex");
  if (hashBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(hashBuffer, derivedKey);
}
