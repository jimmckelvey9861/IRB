CREATE TYPE "public"."event_kind" AS ENUM('unanticipated_problem', 'adverse_event', 'protocol_deviation', 'noncompliance', 'complaint', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('awaiting_determination', 'determined');--> statement-breakpoint
CREATE TYPE "public"."regulatory_report_kind" AS ENUM('unanticipated_problem', 'serious_noncompliance', 'continuing_noncompliance', 'suspension', 'termination');--> statement-breakpoint
CREATE TYPE "public"."regulatory_report_status" AS ENUM('draft', 'signed');--> statement-breakpoint
ALTER TYPE "public"."study_status" ADD VALUE 'lapsed';--> statement-breakpoint
ALTER TYPE "public"."study_status" ADD VALUE 'suspended';--> statement-breakpoint
ALTER TYPE "public"."study_status" ADD VALUE 'terminated';--> statement-breakpoint
ALTER TYPE "public"."submission_kind" ADD VALUE 'continuing';--> statement-breakpoint
CREATE TABLE "event_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"reported_by_id" uuid NOT NULL,
	"kind" "event_kind" NOT NULL,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"status" "event_status" DEFAULT 'awaiting_determination' NOT NULL,
	"determination" jsonb,
	"determined_by_id" uuid,
	"determined_at" timestamp with time zone,
	"signature_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "regulatory_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_report_id" uuid NOT NULL,
	"kind" "regulatory_report_kind" NOT NULL,
	"recipients" text NOT NULL,
	"body" text NOT NULL,
	"body_hash" text NOT NULL,
	"status" "regulatory_report_status" DEFAULT 'draft' NOT NULL,
	"signed_by_id" uuid,
	"signature_id" uuid,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "progress_report" jsonb;--> statement-breakpoint
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reports" ADD CONSTRAINT "event_reports_determined_by_id_users_id_fk" FOREIGN KEY ("determined_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_event_report_id_event_reports_id_fk" FOREIGN KEY ("event_report_id") REFERENCES "public"."event_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_signed_by_id_users_id_fk" FOREIGN KEY ("signed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_reports_study_idx" ON "event_reports" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe" ON "notifications" USING btree ("user_id","dedupe_key");