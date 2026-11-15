CREATE TYPE "public"."attendance_mode" AS ENUM('in_person', 'video', 'phone');--> statement-breakpoint
CREATE TYPE "public"."earning_kind" AS ENUM('expedited_review', 'full_board_primary_review', 'full_board_secondary_review', 'meeting_attendance', 'on_call_hour');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('pending', 'voting', 'decided', 'tabled');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'in_progress', 'adjourned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."motion" AS ENUM('approve', 'require_modifications', 'disapprove', 'table');--> statement-breakpoint
CREATE TYPE "public"."vote_value" AS ENUM('for', 'against', 'abstain');--> statement-breakpoint
CREATE TABLE "availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"on_call" boolean DEFAULT false NOT NULL,
	"stipend_recorded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "earning_kind" NOT NULL,
	"ref_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount_cents" integer NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period_end" date NOT NULL,
	"payout_id" uuid
);
--> statement-breakpoint
CREATE TABLE "item_recusals" (
	"item_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "item_recusals_item_id_member_id_pk" PRIMARY KEY("item_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"mode" "attendance_mode" NOT NULL,
	"replacing_member_id" uuid,
	"has_materials" boolean NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meeting_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"status" "item_status" DEFAULT 'pending' NOT NULL,
	"motion" "motion",
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanation" text,
	"controverted_issues" text,
	"approval_months" integer,
	"children_category" text,
	"votes_for" integer,
	"votes_against" integer,
	"votes_abstain" integer,
	"voting_present" integer,
	"passed" boolean,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone NOT NULL,
	"video_link" text DEFAULT '' NOT NULL,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"chair_member_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"minutes" text,
	"minutes_hash" text,
	"minutes_signature_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "earning_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_end" date NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"item_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"vote" "vote_value" NOT NULL,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_item_id_member_id_pk" PRIMARY KEY("item_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings" ADD CONSTRAINT "earnings_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_recusals" ADD CONSTRAINT "item_recusals_item_id_meeting_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."meeting_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_recusals" ADD CONSTRAINT "item_recusals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_replacing_member_id_members_id_fk" FOREIGN KEY ("replacing_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_items" ADD CONSTRAINT "meeting_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_items" ADD CONSTRAINT "meeting_items_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_chair_member_id_members_id_fk" FOREIGN KEY ("chair_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_item_id_meeting_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."meeting_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_member_idx" ON "availability" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "earnings_once_per_work" ON "earnings" USING btree ("member_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "earnings_member_idx" ON "earnings" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "attendance_meeting_idx" ON "meeting_attendance" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "items_meeting_idx" ON "meeting_items" USING btree ("meeting_id");