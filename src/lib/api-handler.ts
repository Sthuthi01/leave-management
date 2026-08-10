import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";

interface PgError extends Error {
  code?: string;
}

function isUniqueViolation(err: unknown): err is PgError {
  return typeof err === "object" && err !== null && (err as PgError).code === "23505";
}

type RouteHandler<Ctx> = (request: NextRequest, context: Ctx) => Promise<NextResponse>;
// Context is optional at the call-site type level (Next.js only supplies it for dynamic routes;
// tests calling a non-dynamic route's handler with just a request should type-check too), even
// though a given route's own handler may declare it as required for its particular shape.
type WrappedRouteHandler<Ctx> = (request: NextRequest, context?: Ctx) => Promise<NextResponse>;

/**
 * Wraps a route handler so an unexpected thrown error (a bug, a DB constraint violation, a
 * flaky dependency) is always logged with enough context to debug in production, instead of
 * disappearing into an unhandled rejection with nothing but Next.js's default generic 500.
 * Applied to the highest-risk routes (auth, employees, leave-requests) rather than every route
 * in the app, to keep this change's blast radius bounded — see DEPLOYMENT.md for the rationale
 * and the plan to extend it further.
 */
export function withApiHandler<Ctx = unknown>(handler: RouteHandler<Ctx>): WrappedRouteHandler<Ctx> {
  return async (request, context) => {
    try {
      return await handler(request, context as Ctx);
    } catch (err) {
      // A duplicate value on a unique column (e.g. an employee email that already exists) is a
      // foreseeable, user-actionable error, not a bug — worth a clear 409 instead of a generic 500.
      if (isUniqueViolation(err)) {
        return NextResponse.json({ error: "That value is already in use." }, { status: 409 });
      }

      // Structured so it's greppable/parseable in production logs — includes the stack trace
      // here (server-side log only; never sent to the client) since that's exactly where it's
      // needed to actually debug the failure.
      console.error(
        JSON.stringify({
          level: "error",
          timestamp: new Date().toISOString(),
          method: request.method,
          route: request.nextUrl.pathname,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
      );

      // Also reported to Sentry (if configured — see sentry.server.config.ts), tagged with just
      // the method and route, never the request body or any employee/customer data, so an
      // on-call person gets alerted without that data ever leaving this server. A no-op if
      // SENTRY_DSN isn't set.
      Sentry.captureException(err, { tags: { route: request.nextUrl.pathname, method: request.method } });

      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}
