CREATE TYPE "public"."complaint_status" AS ENUM('open', 'responded', 'referred');--> statement-breakpoint
CREATE TYPE "public"."policy_version_status" AS ENUM('draft', 'in_effect', 'superseded');--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"study_reference" text DEFAULT '' NOT NULL,
	"study_id" uuid,
	"from_role" text NOT NULL,
	"message" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"contact_detail" text DEFAULT '' NOT NULL,
	"status" "complaint_status" DEFAULT 'open' NOT NULL,
	"response" text,
	"responded_by_id" uuid,
	"responded_at" timestamp with time zone,
	"event_report_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaints_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"sources" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "policy_acknowledgments" (
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_acknowledgments_version_id_user_id_pk" PRIMARY KEY("version_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"body_hash" text NOT NULL,
	"change_summary" text DEFAULT '' NOT NULL,
	"status" "policy_version_status" DEFAULT 'draft' NOT NULL,
	"drafted_by_id" uuid,
	"approved_by_id" uuid,
	"signature_id" uuid,
	"effective_from" date,
	"review_due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"metrics" jsonb NOT NULL,
	"findings" text NOT NULL,
	"actions" text NOT NULL,
	"signed_by_id" uuid NOT NULL,
	"signature_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course" text NOT NULL,
	"completed_on" date NOT NULL,
	"expires_on" date,
	"evidence" text DEFAULT '' NOT NULL,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_responded_by_id_users_id_fk" FOREIGN KEY ("responded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_event_report_id_event_reports_id_fk" FOREIGN KEY ("event_report_id") REFERENCES "public"."event_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgments" ADD CONSTRAINT "policy_acknowledgments_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgments" ADD CONSTRAINT "policy_acknowledgments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_drafted_by_id_users_id_fk" FOREIGN KEY ("drafted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_reviews" ADD CONSTRAINT "qa_reviews_signed_by_id_users_id_fk" FOREIGN KEY ("signed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_unique" ON "policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE INDEX "training_user_idx" ON "training_records" USING btree ("user_id");--> statement-breakpoint
-- Training evidence and signed quality reviews are permanent records.
CREATE TRIGGER training_no_update_delete BEFORE UPDATE OR DELETE ON training_records
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER qa_reviews_no_update_delete BEFORE UPDATE OR DELETE ON qa_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
-- Once a policy version has been approved its text can never change; a new version is needed.
CREATE FUNCTION policy_text_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'approved policy versions cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.body_hash IS DISTINCT FROM OLD.body_hash OR NEW.version IS DISTINCT FROM OLD.version) THEN
    RAISE EXCEPTION 'approved policy text cannot be changed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER policy_versions_frozen BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION policy_text_frozen();
