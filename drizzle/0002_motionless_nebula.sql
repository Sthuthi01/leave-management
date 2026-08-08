CREATE TYPE "public"."resource_category" AS ENUM('GUIDE', 'POLICY', 'TRAINING');--> statement-breakpoint
CREATE TABLE "employee_task_completions" (
	"employee_id" text NOT NULL,
	"task_id" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "employee_task_completions_employee_id_task_id_pk" PRIMARY KEY("employee_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "onboarding_checklists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" "resource_category" NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"url" text,
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"checklist_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"resource_id" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "onboarding_checklist_id" text;--> statement-breakpoint
ALTER TABLE "employee_task_completions" ADD CONSTRAINT "employee_task_completions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_task_completions" ADD CONSTRAINT "employee_task_completions_task_id_onboarding_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."onboarding_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_checklist_id_onboarding_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."onboarding_checklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_resource_id_onboarding_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."onboarding_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_onboarding_checklist_id_onboarding_checklists_id_fk" FOREIGN KEY ("onboarding_checklist_id") REFERENCES "public"."onboarding_checklists"("id") ON DELETE no action ON UPDATE no action;