CREATE TABLE "onboarding_resource_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"data_base64" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_resource_versions" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_resources" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_resource_documents" ADD CONSTRAINT "onboarding_resource_documents_resource_id_onboarding_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."onboarding_resources"("id") ON DELETE no action ON UPDATE no action;