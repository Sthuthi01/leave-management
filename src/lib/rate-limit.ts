interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// In-memory fixed-window rate limiter — sufficient for a single-instance deployment (the
// documented default in DEPLOYMENT.md). If you scale this app to multiple replicas, each
// instance would enforce its own independent limit; swap the Map for a shared store (e.g.
// Redis) behind these same function signatures at that point.

function cleanupExpired(now: number): void {
  // Opportunistic, so the map doesn't grow unboundedly from one-off keys (e.g. many distinct
  // IPs) that are never checked again — cheap relative to how rarely auth endpoints are hit
  // compared to the rest of the app.
  if (Math.random() >= 0.01) return;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

/** Read-only: true if `key` has already hit `limit` failures within the current window. Callers
 *  check this *before* doing any real work, so a blocked caller doesn't pay the cost of a wasted
 *  password hash comparison — but a request that goes on to succeed never counts against this in
 *  the first place (see recordFailedAttempt/clearRateLimit below), so it never blocks legitimate
 *  repeated logins, only repeated *failures*. */
export function isRateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  cleanupExpired(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return false;
  return bucket.count >= limit;
}

/** Call only when an attempt actually fails (wrong password, unknown account, etc.) — never for
 *  a successful one. This is what makes the limiter target brute-force/credential-stuffing
 *  specifically, rather than penalizing someone (or an automated test) who simply logs in
 *  correctly many times in a row. */
export function recordFailedAttempt(key: string, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    bucket.count += 1;
  }
}

/** Call on a successful attempt, so a past run of failures doesn't linger and eventually block a
 *  legitimate, now-successful, caller for the rest of the window. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Flat variant for endpoints with no success/failure distinction from the caller's point of
 *  view (e.g. forgot-password always replies identically either way) — every call counts. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  cleanupExpired(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/**
 * Best-effort client IP for rate-limit keys. X-Forwarded-For is a client-supplied header — it is
 * only trustworthy when a reverse proxy in front of this app overwrites it with the real
 * connecting IP before forwarding (see DEPLOYMENT.md). Next.js Route Handlers have no lower-level
 * access to the raw socket, so there is no way to verify that here.
 *
 * SECURITY: if this app is deployed WITHOUT such a proxy (e.g. exposed directly to the internet),
 * a caller can set an arbitrary X-Forwarded-For value on each request to get a fresh rate-limit
 * bucket every time, fully bypassing login/forgot-password/set-password rate limiting. Never
 * deploy this app directly on the public internet without a reverse proxy that sets this header
 * itself and strips/overwrites any client-supplied copy.
 *
 * CI/local dev note: the reverse-proxy-less `docker-compose.yml` stack (used by the E2E suite)
 * has neither header set, so this falls back to the literal string "unknown" for every request —
 * every caller in that environment shares one rate-limit bucket per key. See the "rate limiting
 * during repeated CI/local runs" note in README.md's Testing section if a set-password 429 shows
 * up during repeated local/CI test runs; it's expected there, not a bug.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
