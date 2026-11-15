CREATE TYPE "public"."member_status" AS ENUM('pending_appointment', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."membership_type" AS ENUM('primary', 'alternate');--> statement-breakpoint
CREATE TYPE "public"."primary_concern" AS ENUM('scientific', 'nonscientific');--> statement-breakpoint
CREATE TYPE "public"."system_role" AS ENUM('administrator', 'official', 'chair', 'member');--> statement-breakpoint
CREATE TABLE "alternate_for" (
	"alternate_member_id" uuid NOT NULL,
	"primary_member_id" uuid NOT NULL,
	CONSTRAINT "alternate_for_alternate_member_id_primary_member_id_pk" PRIMARY KEY("alternate_member_id","primary_member_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp (6) with time zone NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "member_status" DEFAULT 'pending_appointment' NOT NULL,
	"membership_type" "membership_type" NOT NULL,
	"primary_concern" "primary_concern" NOT NULL,
	"affiliated" boolean NOT NULL,
	"profession" text NOT NULL,
	"degrees" text DEFAULT '' NOT NULL,
	"gender" text,
	"expertise" text[] DEFAULT '{}'::text[] NOT NULL,
	"experienced_reviewer" boolean DEFAULT false NOT NULL,
	"training_completed_on" date,
	"term_ends_on" date,
	"appointed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"meaning" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"record_hash" text NOT NULL,
	"signed_at" timestamp (6) with time zone NOT NULL,
	"audit_seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"roles" "system_role"[] DEFAULT '{}'::system_role[] NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alternate_for" ADD CONSTRAINT "alternate_for_alternate_member_id_members_id_fk" FOREIGN KEY ("alternate_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alternate_for" ADD CONSTRAINT "alternate_for_primary_member_id_members_id_fk" FOREIGN KEY ("primary_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signatures_entity_idx" ON "signatures" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));