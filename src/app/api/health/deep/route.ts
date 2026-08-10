import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";

// Unauthenticated on purpose, same as /api/health — this is what an EXTERNAL uptime monitor
// (e.g. UptimeRobot) should poll, not /api/health itself.
//
// The difference: /api/health only proves the Node.js process is up, which Docker's own
// HEALTHCHECK relies on to decide whether to restart the `app` container — that check
// deliberately stays cheap and DB-independent, so a brief database hiccup doesn't trigger
// restart after restart of a container that isn't actually broken.
//
// This route additionally runs a trivial query against the database, because "the process is
// running" and "the app can actually do anything useful" are different questions, and the second
// one is what a human being actually needs to be alerted about. A 5-second timeout keeps a
// genuinely hung database from also hanging this check forever.
export async function GET() {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Database check timed out")), 5000));

  try {
    await Promise.race([db.execute(sql`select 1`), timeout]);
    return NextResponse.json({ status: "ok", checks: { database: "ok" } });
  } catch {
    // Deliberately no error detail in the response — this endpoint is unauthenticated, so it
    // should say "something's wrong" without describing what, to avoid handing a stranger any
    // information about the database. Full detail goes to Sentry/logs, not this response.
    return NextResponse.json({ status: "error", checks: { database: "unreachable" } }, { status: 503 });
  }
}
