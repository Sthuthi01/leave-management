This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Docker

The app ships with a multi-stage `Dockerfile` built around Next.js's `output: "standalone"` mode, so the image only contains what's needed to run the server — not the full `node_modules` or source tree.

### Local development

```bash
cp .env.example .env   # fill in values if you want, defaults work out of the box
docker compose up --build
```

This starts three containers: `app` on [http://localhost:3000](http://localhost:3000), a Postgres `db` (data persisted in a named volume, exposed on host port `5433`), and [Mailpit](https://mailpit.axllent.org/) — a fake SMTP server that catches every invitation/password-reset email the app sends, viewable at [http://localhost:8025](http://localhost:8025), so nothing gets sent to a real inbox while testing.

A container health check hits `/api/health`; `docker compose ps` will show `app` as `healthy` once the server is accepting requests.

### Production

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full guide — required environment variables, configuring a real SMTP provider (SendGrid, SES, Postmark, Mailgun, etc.), using a managed database instead of a bundled one, and secrets management. Quick version:

```bash
cp .env.production.example .env
# fill in every value — docker-compose.prod.yml refuses to start if any required one is missing
docker compose -f docker-compose.prod.yml up -d --build
```

## Testing

```bash
npm test            # unit tests (vitest) — pure logic + mocked-auth RBAC checks, no DB/server needed
npm run test:watch  # same, in watch mode
npm run test:e2e    # end-to-end (Playwright) — needs the local dev stack running first:
                     #   docker compose up -d
```

The E2E suite (`tests/e2e/`) drives a real browser against the running `docker-compose.yml` stack and reads generated invitation/reset emails straight out of Mailpit's API — it covers login/logout, invitation → set password → auto sign-in, forgot/reset password, change password, leave application → approval/rejection, and role-based access (an Employee or Manager hitting an HR-Admin-only page or API directly gets blocked). It shares whatever database state the stack currently has — each test creates its own throwaway employee(s) rather than relying on or resetting existing data, so it's safe to run against your everyday local dev database.

**A note on rate limiting during repeated CI/local runs:** `POST /api/auth/set-password` is rate-limited to 10 requests per 15-minute window (see `src/lib/rate-limit.ts`), keyed by client IP. Each full E2E run submits 5 such requests (invitation activation, password reset, change-password setup flows). Behind a real reverse proxy each caller gets a distinct IP-based bucket, so a normal user never comes close to this limit — but the local `docker-compose.yml` stack has no reverse proxy, so every request in that environment falls back to one shared bucket (see the `getClientIp` comment in `src/lib/rate-limit.ts` for why). Running the suite more than twice within the same 15-minute window — e.g. while iterating on a test locally, or a CI job that reruns the suite — can exhaust that shared bucket and cause later, entirely legitimate set-password submissions to receive a real `429`. This is the rate limiter working as designed, not test flakiness. If you hit it:
- Restart the `app` container (`docker compose restart app`) — its rate-limit state is in-memory only, so this clears it instantly without touching the database or any other state, or
- Wait for the 15-minute window to elapse.

Do not raise this limit or special-case test traffic to work around it — it's a deliberate anti-abuse control and applies identically in UAT and production.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
