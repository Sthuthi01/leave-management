-- Custom SQL migration file, put your code below! --

-- app_settings is a single-row (id=1) table that loadSnapshot() always reads and never treats as
-- optional (see rowToSettings in src/lib/db/repo.ts) — but until now, the only code path that
-- ever inserted that row was the demo-data seeder (src/lib/db/seed.ts), gated behind
-- SEED_DEMO_DATA=true. Any environment where that's off (which is every UAT/production
-- deployment today — docker-compose.prod.yml never sets it, and correctly so) started with zero
-- rows in this table, and the app crashed on the very first request that touched settings (e.g.
-- login, or set-password) with "Cannot read properties of undefined (reading 'workingDays')".
-- This inserts the same default values src/lib/mock-data/seed.ts's defaultSettings already uses,
-- unconditionally, so every environment has a working settings row regardless of demo seeding.
-- ON CONFLICT DO NOTHING makes this safe to apply even where a row already exists (e.g. upgrading
-- a deployment that already ran with demo data seeded).
INSERT INTO app_settings (id, working_days, upcoming_leave_window_days, pending_approval_urgency_days, audit_log_display_limit, session_max_age_days)
VALUES (1, '{1,2,3,4,5}', 30, 3, 200, 30)
ON CONFLICT (id) DO NOTHING;