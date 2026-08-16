# Deployment guide

This file used to document the repository's original Next.js/Drizzle implementation, which has
since been fully replaced by the current React + TypeScript + Ant Design / Django + DRF /
PostgreSQL / Docker stack (see [`README.md`](./README.md) and
[`MIGRATION_AUDIT.md`](./MIGRATION_AUDIT.md) for the evidence).

**The full deployment guide for the current application lives in
[`DEPLOYMENT.backend.md`](./DEPLOYMENT.backend.md).** It covers, for both UAT and production:

- Prerequisites and required environment variables
- First HR Admin creation (`bootstrap_admin` management command)
- Database migrations
- **Backup and disaster recovery** (§12) — using `backend-backup/`, targeting `backend-db`
- TLS / reverse proxy (Caddy)
- Health checks
- Rolling out an update
- Secrets management

This top-level `DEPLOYMENT.md` is kept only so a reader who opens it by habit lands somewhere
useful — it intentionally does not duplicate `DEPLOYMENT.backend.md`'s content, to avoid the two
documents drifting out of sync with each other over time.
