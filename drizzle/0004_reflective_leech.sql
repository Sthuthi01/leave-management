CREATE TYPE "public"."resource_audience_scope" AS ENUM('ALL', 'DEPARTMENT', 'ROLE');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('DRAFT', 'PUBLISHED');--> statement-breakpoint
CREATE TABLE "onboarding_resource_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_resource_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"category" "resource_category" NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"url" text,
	"edited_at" timestamp with time zone NOT NULL,
	"edited_by_id" text NOT NULL,
	"edited_by_name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_resources" ALTER COLUMN "is_active" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "onboarding_resources" ADD COLUMN "status" "resource_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_resources" ADD COLUMN "is_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_resources" ADD COLUMN "audience_scope" "resource_audience_scope" DEFAULT 'ALL' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_resources" ADD COLUMN "audience_department_id" text;--> statement-breakpoint
ALTER TABLE "onboarding_resources" ADD COLUMN "audience_role" "role";--> statement-breakpoint
ALTER TABLE "onboarding_resources" ADD COLUMN "effective_date" date;--> statement-breakpoint
ALTER TABLE "onboarding_resources" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_resource_attachments" ADD CONSTRAINT "onboarding_resource_attachments_resource_id_onboarding_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."onboarding_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_resource_versions" ADD CONSTRAINT "onboarding_resource_versions_resource_id_onboarding_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."onboarding_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_resources" ADD CONSTRAINT "onboarding_resources_audience_department_id_departments_id_fk" FOREIGN KEY ("audience_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;