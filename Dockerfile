# syntax=docker/dockerfile:1

FROM node:20-alpine AS base

# ---- deps: install dependencies in their own layer so `npm ci` only reruns when
# package.json/package-lock.json/vendor actually change, not on every source edit ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# xlsx is installed from a vendored tarball (vendor/xlsx-0.20.3.tgz), not the npm registry or
# cdn.sheetjs.com — see package.json's "xlsx" dependency — so `npm ci` never needs network access
# beyond the npm registry itself, and isn't at the mercy of an external CDN's uptime during a
# build. Must be copied in before `npm ci` since that's what actually resolves the file: reference.
COPY vendor ./vendor
RUN npm ci

# ---- builder: compile the Next.js app ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: minimal production image, just the standalone server output ----
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Not traced by Next's bundler (read from disk at startup, not imported) — copied explicitly so
# ensureReady() (src/lib/db/client.ts) can find and run pending migrations against Postgres.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
