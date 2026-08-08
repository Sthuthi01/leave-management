-- Backs nextRequestId()'s atomic reference-number generation (e.g. LR-2026-0021).
-- Start value is 1; the seed script advances it past the seeded demo requests via setval().
CREATE SEQUENCE IF NOT EXISTS leave_request_seq START WITH 1;
