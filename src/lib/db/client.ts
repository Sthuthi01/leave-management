import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema";

// Reused across Next.js dev-server hot reloads (same pattern the old in-memory
// store used) so we don't open a fresh connection pool on every file edit.
const globalForDb = globalThis as unknown as {
  __leaflowSql?: postgres.Sql;
  __leaflowDb?: PostgresJsDatabase<typeof schema>;
  __leaflowReady?: Promise<void>;
};

/**
 * Connecting eagerly at module load would make `next build` fail — it imports every route
 * module (including this one, transitively) to statically analyze them, with no DATABASE_URL
 * available at build time. So the real connection is only opened the first time a query actually
 * runs, via this proxy, which is always at request time.
 */
function getRealDb(): PostgresJsDatabase<typeof schema> {
  if (!globalForDb.__leaflowDb) {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");

    const sql = globalForDb.__leaflowSql ?? postgres(DATABASE_URL, { max: 10 });
    globalForDb.__leaflowSql = sql;
    globalForDb.__leaflowDb = drizzle(sql, { schema });
  }
  return globalForDb.__leaflowDb;
}

export const db: PostgresJsDatabase<typeof schema> = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getRealDb(), prop, receiver);
  },
});

/**
 * Runs pending migrations, then (only if explicitly opted in — see seedIfEmpty) seeds demo data,
 * then invites any pre-existing employee left without a password. Safe to call repeatedly.
 */
async function initialize(): Promise<void> {
  await migrate(getRealDb(), { migrationsFolder: "./drizzle" });

  // Demo/mock data must never appear in production. Opt-in explicitly (docker-compose.yml sets
  // this for local dev) rather than the previous "seed whenever the database happens to be
  // empty" behavior, which would have populated a fresh production database with demo accounts
  // sharing a single known password.
  if (process.env.SEED_DEMO_DATA === "true") {
    const { seedIfEmpty } = await import("./seed");
    await seedIfEmpty();
  }

  const { inviteEmployeesMissingPassword } = await import("@/lib/invitation-service");
  await inviteEmployeesMissingPassword();
}

/**
 * Awaited once per process before any query runs. If initialize() rejects (a transient DB
 * outage at startup, a migration that fails once, etc.), the cached promise is cleared before
 * rethrowing — otherwise every future call would keep returning that same rejected promise
 * forever, silently failing every request for the rest of the process's life with no way to
 * recover short of a restart. Clearing it lets the next call retry from scratch instead.
 */
export function ensureReady(): Promise<void> {
  if (!globalForDb.__leaflowReady) {
    globalForDb.__leaflowReady = initialize().catch((err) => {
      globalForDb.__leaflowReady = undefined;
      throw err;
    });
  }
  return globalForDb.__leaflowReady;
}
