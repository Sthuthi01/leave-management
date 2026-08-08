CREATE TYPE "public"."accrual_method" AS ENUM('ANNUAL', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('EMPLOYEE', 'ADMIN');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"working_days" integer[] NOT NULL,
	"upcoming_leave_window_days" integer NOT NULL,
	"pending_approval_urgency_days" integer NOT NULL,
	"audit_log_display_limit" integer NOT NULL,
	"session_max_age_days" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_label" text NOT NULL,
	"details" text
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"avatar_url" text,
	"role" "role" NOT NULL,
	"title" text NOT NULL,
	"department_id" text NOT NULL,
	"manager_id" text,
	"joined_at" date NOT NULL,
	"status" "employee_status" NOT NULL,
	CONSTRAINT "employees_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"optional" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"employee_id" text NOT NULL,
	"leave_type_id" text NOT NULL,
	"year" integer NOT NULL,
	"allocated" integer NOT NULL,
	"used" integer NOT NULL,
	"carried_forward" integer NOT NULL,
	CONSTRAINT "leave_balances_employee_id_leave_type_id_year_pk" PRIMARY KEY("employee_id","leave_type_id","year")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_number" text NOT NULL,
	"employee_id" text NOT NULL,
	"leave_type_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "leave_status" NOT NULL,
	"approver_id" text,
	"approver_comment" text,
	"applied_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "leave_requests_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"color" text NOT NULL,
	"default_days_per_year" integer NOT NULL,
	"requires_approval" boolean NOT NULL,
	"is_active" boolean NOT NULL,
	"accrual_method" "accrual_method" NOT NULL,
	"carry_forward_limit" integer NOT NULL,
	CONSTRAINT "leave_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;