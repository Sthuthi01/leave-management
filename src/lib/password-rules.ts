import { z } from "zod";

/**
 * Shared strength rule for every place a user picks a new password (invite setup, forgot-password
 * reset, self-service change) — defined once so the client-side form and the server-side route
 * enforcing it can never drift apart. Kept in its own file, separate from password.ts, because that
 * file imports Node's `crypto` module for hashing — safe on the server, but it must never end up in
 * a client bundle, whereas this plain zod schema is safe to import from "use client" forms too.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .regex(/[a-zA-Z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");
