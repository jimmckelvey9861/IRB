CREATE TYPE "public"."assignment_role" AS ENUM('primary_reviewer', 'secondary_reviewer');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'completed', 'withdrawn_conflict');--> statement-breakpoint
CREATE TYPE "public"."decision" AS ENUM('approve', 'require_modifications', 'disapprove', 'refer_to_full_board');--> statement-breakpoint
CREATE TYPE "public"."review_path" AS ENUM('expedited', 'full_board');--> statement-breakpoint
CREATE TYPE "public"."study_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."submission_kind" AS ENUM('initial', 'amendment');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'in_review', 'awaiting_meeting', 'modifications_required', 'approved', 'disapproved');--> statement-breakpoint
ALTER TYPE "public"."system_role" ADD VALUE 'investigator';--> statement-breakpoint
CREATE TABLE "conflict_declarations" (
	"member_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"has_conflict" boolean NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflict_declarations_member_id_study_id_pk" PRIMARY KEY("member_id","study_id")
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"body_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "assignment_role" NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"decision" "decision",
	"explanation" text,
	"approval_months" integer,
	"confirms_expedited" boolean,
	"signature_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"irb_number" text NOT NULL,
	"title" text NOT NULL,
	"sponsor" text NOT NULL,
	"principal_investigator_id" uuid NOT NULL,
	"expertise" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "study_status" DEFAULT 'active' NOT NULL,
	"approval_expires_on" date,
	"retain_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studies_irb_number_unique" UNIQUE("irb_number")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"kind" "submission_kind" NOT NULL,
	"status" "submission_status" DEFAULT 'draft' NOT NULL,
	"submitted_by_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"protocol_text" text DEFAULT '' NOT NULL,
	"consent_text" text DEFAULT '' NOT NULL,
	"minimal_risk" boolean NOT NULL,
	"expedited_category" integer,
	"minor_change" boolean DEFAULT false NOT NULL,
	"applicable_clinical_trial" boolean DEFAULT true NOT NULL,
	"involves_children" boolean DEFAULT false NOT NULL,
	"involves_vulnerable" boolean DEFAULT false NOT NULL,
	"consent_resolutions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"path" "review_path",
	"path_basis" text,
	"consultant_needed" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conflict_declarations" ADD CONSTRAINT "conflict_declarations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_declarations" ADD CONSTRAINT "conflict_declarations_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_principal_investigator_id_users_id_fk" FOREIGN KEY ("principal_investigator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_member_idx" ON "review_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "assignments_submission_idx" ON "review_assignments" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submissions_study_idx" ON "submissions" USING btree ("study_id");