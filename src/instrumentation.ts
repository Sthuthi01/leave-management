import * as Sentry from "@sentry/nextjs";

// How long to keep retrying database initialization at startup before giving up — generous
// enough to ride out the kind of brief blip `depends_on: condition: service_healthy` doesn't
// fully rule out (e.g. Postgres accepting TCP connections a moment before it's actually ready
// for queries), without hanging a broken deployment forever.
const DB_INIT_MAX_ATTEMPTS = 30;
const DB_INIT_RETRY_DELAY_MS = 2000; // 30 attempts * 2s = up to ~60s total.

async function initializeDatabaseWithRetry(): Promise<void> {
  const { ensureReady } = await import("@/lib/db/client");

  for (let attempt = 1; attempt <= DB_INIT_MAX_ATTEMPTS; attempt++) {
    try {
      await ensureReady();
      return;
    } catch (err) {
      const isLastAttempt = attempt === DB_INIT_MAX_ATTEMPTS;
      console.error(
        `[startup] Database initialization attempt ${attempt}/${DB_INIT_MAX_ATTEMPTS} failed` +
          (isLastAttempt ? "." : `, retrying in ${DB_INIT_RETRY_DELAY_MS / 1000}s.`),
        err instanceof Error ? err.message : err
      );
      if (isLastAttempt) throw err;
      await new Promise((resolve) => setTimeout(resolve, DB_INIT_RETRY_DELAY_MS));
    }
  }
}

// Next.js calls this once when the server process starts, and — per Next's own docs — it "must
// complete before the server is ready to handle requests". That's what makes this the right place
// to run pending DB migrations: `docker compose ps`/the Dockerfile's HEALTHCHECK can't see the
// `app` container as healthy until it's accepting connections at all, and now it won't accept
// connections until migrations have finished. Previously migrations only ran lazily on the first
// real request through src/lib/db/repo.ts, so a container could look "healthy" for a while before
// the database was actually ready.
//
// Verified experimentally: if this function throws, Next.js does NOT crash the process — it just
// leaves the server up and returns 500 for every route (including /api/health itself) forever,
// with no automatic recovery. That would turn a transient startup DB blip into a permanent outage
// requiring someone to notice and restart the container by hand — worse than the lazy-init
// behavior this change replaces. initializeDatabaseWithRetry() rides out anything short-lived; if
// the database is still unreachable after ~60s, this deliberately exits instead of leaving the
// process in that stuck state, handing recovery off to Docker's own restart policy (`restart:
// unless-stopped` / `restart: always` — see docker-compose.yml / docker-compose.prod.yml), which
// is the standard, well-understood way to recover from a startup failure retrying couldn't fix.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    try {
      await initializeDatabaseWithRetry();
    } catch (err) {
      Sentry.captureException(err, { tags: { context: "startup-db-init" } });
      await Sentry.flush(2000);
      console.error("[startup] Giving up on database initialization — exiting so the container can restart.");
      process.exit(1);
    }
  }
}

// Next.js's built-in hook for reporting an error thrown by a Server Component or Route Handler
// that isn't already caught elsewhere — see withApiHandler (src/lib/api-handler.ts) for the
// explicit capture used on routes that catch their own errors; this is the backstop for
// everything else. A no-op if SENTRY_DSN isn't set (see sentry.server.config.ts).
export const onRequestError = Sentry.captureRequestError;
