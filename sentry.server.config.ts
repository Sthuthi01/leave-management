import * as Sentry from "@sentry/nextjs";

// Only turns on if SENTRY_DSN is set — the same "missing config quietly does nothing" pattern
// used everywhere else in this app (see SMTP_HOST in src/lib/email.ts), so local development and
// any deployment that hasn't set this up yet keep working normally, just without error reporting.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,

    // Error tracking only — no performance tracing, profiling, or session replay. Kept
    // deliberately minimal so this collects the least data necessary to know when something
    // breaks, rather than instrumenting everything Sentry is capable of.
    tracesSampleRate: 0,

    // Never automatically attach IP addresses or other identifying request data.
    sendDefaultPii: false,

    beforeSend(event) {
      // Defense in depth on top of sendDefaultPii: false — strip anything that could carry an
      // employee/customer's session credentials or personal data before it ever leaves this
      // server. withApiHandler (src/lib/api-handler.ts) already avoids passing request bodies or
      // employee data as error context, so this is a backstop, not the only safeguard.
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers["cookie"];
          delete event.request.headers["authorization"];
        }
        // The invitation/password-reset link is a single-use secret carried in a `?token=...`
        // query parameter (see /set-password), not a header or cookie — if an error were ever
        // captured while rendering that page via Next's automatic request-error instrumentation
        // (src/instrumentation.ts's onRequestError), the raw URL would otherwise carry that token
        // straight into Sentry. Same redaction pattern already used for the console-log fallback
        // in src/lib/email.ts, applied here too so both paths agree.
        if (typeof event.request.url === "string") {
          event.request.url = event.request.url.replace(/token=[^&\s]+/g, "token=[redacted]");
        }
        if (typeof event.request.query_string === "string") {
          event.request.query_string = event.request.query_string.replace(/token=[^&\s]+/g, "token=[redacted]");
        }
      }
      delete event.user;
      return event;
    },
  });
}
