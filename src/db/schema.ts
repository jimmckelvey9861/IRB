import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * System roles. A person can hold several.
 * - administrator: manages accounts and the roster (no voting power by itself)
 * - official: the AAHRPP "organizational official" (AAHRPP I.1.B); signs member appointments
 * - chair: IRB chair; may designate experienced reviewers (21 CFR 56.110(b))
 * - member: a voting IRB member (primary or alternate)
 */
export const systemRole = pgEnum("system_role", [
  "administrator",
  "official",
  "chair",
  "member",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    totpSecret: text("totp_secret"),
    roles: systemRole("roles").array().notNull().default(sql`'{}'::system_role[]`),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the session token; the raw token only lives in the user's cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    /** Secret offered during authenticator enrollment; copied to the user only once a code is confirmed. */
    pendingTotpSecret: text("pending_totp_secret"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const primaryConcern = pgEnum("primary_concern", ["scientific", "nonscientific"]);
export const membershipType = pgEnum("membership_type", ["primary", "alternate"]);
export const memberStatus = pgEnum("member_status", ["pending_appointment", "active", "inactive"]);

/** An IRB member. 21 CFR 56.107; AAHRPP II.1.A. */
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id)
    .unique(),
  status: memberStatus("status").notNull().default("pending_appointment"),
  membershipType: membershipType("membership_type").notNull(),
  primaryConcern: primaryConcern("primary_concern").notNull(),
  /** Affiliated with the institution operating the IRB, or immediate family of someone who is (56.107(d)). */
  affiliated: boolean("affiliated").notNull(),
  profession: text("profession").notNull(),
  degrees: text("degrees").notNull().default(""),
  /** Optional, used only for the 56.107(b) "not all one gender" check. */
  gender: text("gender"),
  expertise: text("expertise").array().notNull().default(sql`'{}'::text[]`),
  /** Designated by the chair as experienced enough for expedited review (56.110(b)). */
  experiencedReviewer: boolean("experienced_reviewer").notNull().default(false),
  trainingCompletedOn: date("training_completed_on"),
  termEndsOn: date("term_ends_on"),
  appointedAt: timestamp("appointed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Which primary members each alternate may replace (FDA IRB FAQ 15). */
export const alternateFor = pgTable(
  "alternate_for",
  {
    alternateMemberId: uuid("alternate_member_id")
      .notNull()
      .references(() => members.id),
    primaryMemberId: uuid("primary_member_id")
      .notNull()
      .references(() => members.id),
  },
  (t) => [primaryKey({ columns: [t.alternateMemberId, t.primaryMemberId] })],
);

/**
 * Append-only, hash-chained audit trail (21 CFR 11.10(e)).
 * A database trigger rejects UPDATE, DELETE and TRUNCATE on this table.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 6 }).notNull(),
    actorUserId: uuid("actor_user_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId)],
);

/** Electronic signatures (21 CFR 11.50, 11.70, 11.100, 11.200). */
export const signatures = pgTable(
  "signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    signerName: text("signer_name").notNull(),
    meaning: text("meaning").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** sha256 of the canonical record content at signing time; links signature to record (11.70). */
    recordHash: text("record_hash").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true, precision: 6 }).notNull(),
    auditSeq: integer("audit_seq").notNull(),
  },
  (t) => [index("signatures_entity_idx").on(t.entityType, t.entityId)],
);
