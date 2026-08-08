CREATE TYPE "public"."token_purpose" AS ENUM('INVITE', 'RESET');--> statement-breakpoint
CREATE TABLE "password_setup_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "password_setup_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "password_setup_tokens" ADD CONSTRAINT "password_setup_tokens_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
-- Any employee that already existed before this migration (no password, never invited) is
-- handled by application code at startup instead of a data backfill here: see
-- inviteEmployeesMissingPassword() in src/lib/invitation-service.ts, called from
-- ensureReady() in src/lib/db/client.ts. It sends them a real invitation email rather than
-- assigning any password value directly — a migration file is the wrong place to embed a
-- credential of any kind, known or generated.