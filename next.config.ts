import type { NextConfig } from "next";

// A CSP without per-request nonces can't tighten script-src/style-src beyond 'unsafe-inline'
// without breaking Next.js's own hydration script and Radix/base-ui's inline-styled popovers —
// several pages here are statically prerendered, which rules out wiring per-request nonces
// through cleanly. This still meaningfully restricts everything else (framing, base URI,
// plugins, cross-origin fetch/connect targets), and is a real improvement over no CSP at all.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Produces a minimal .next/standalone build (only the files actually needed at
  // runtime, no full node_modules) — what the Docker image below is built around.
  output: "standalone",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Ignored by browsers over plain HTTP (e.g. local dev), so safe to always send —
          // only takes effect once the app is actually served over HTTPS in production.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
        ],
      },
    ];
  },
};

export default nextConfig;
