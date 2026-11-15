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
 * - investigator: a researcher who submits studies (cannot see other studies or IRB deliberations)
 */
export const systemRole = pgEnum("system_role", [
  "administrator",
  "official",
  "chair",
  "member",
  "investigator",
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

export const studyStatus = pgEnum("study_status", ["active", "closed"]);

/** A research study (protocol) overseen by the IRB. */
export const studies = pgTable("studies", {
  id: uuid("id").primaryKey().defaultRandom(),
  irbNumber: text("irb_number").notNull().unique(),
  title: text("title").notNull(),
  sponsor: text("sponsor").notNull(),
  principalInvestigatorId: uuid("principal_investigator_id")
    .notNull()
    .references(() => users.id),
  /** Expertise needed to review it, matched against member expertise (AAHRPP II.1.E). */
  expertise: text("expertise").array().notNull().default(sql`'{}'::text[]`),
  status: studyStatus("status").notNull().default("active"),
  /** Approval lapses after this date unless renewed (21 CFR 56.109(f)). */
  approvalExpiresOn: date("approval_expires_on"),
  /** Records may not be destroyed before this date (21 CFR 56.115(b): 3 years after completion). */
  retainUntil: date("retain_until"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const submissionKind = pgEnum("submission_kind", ["initial", "amendment"]);
export const submissionStatus = pgEnum("submission_status", [
  "draft",
  "in_review",
  "awaiting_meeting",
  "modifications_required",
  "approved",
  "disapproved",
]);
export const reviewPath = pgEnum("review_path", ["expedited", "full_board"]);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    kind: submissionKind("kind").notNull(),
    status: submissionStatus("status").notNull().default("draft"),
    submittedById: uuid("submitted_by_id")
      .notNull()
      .references(() => users.id),
    summary: text("summary").notNull(),
    protocolText: text("protocol_text").notNull().default(""),
    consentText: text("consent_text").notNull().default(""),
    minimalRisk: boolean("minimal_risk").notNull(),
    expeditedCategory: integer("expedited_category"),
    minorChange: boolean("minor_change").notNull().default(false),
    applicableClinicalTrial: boolean("applicable_clinical_trial").notNull().default(true),
    involvesChildren: boolean("involves_children").notNull().default(false),
    involvesVulnerable: boolean("involves_vulnerable").notNull().default(false),
    /** Where the submitter says each element the checker could not find is covered. */
    consentResolutions: jsonb("consent_resolutions").notNull().default(sql`'[]'::jsonb`),
    path: reviewPath("path"),
    pathBasis: text("path_basis"),
    consultantNeeded: boolean("consultant_needed").notNull().default(false),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("submissions_study_idx").on(t.studyId)],
);

/** A member's conflict-of-interest declaration for a study (21 CFR 56.107(e); AAHRPP II.1.D). */
export const conflictDeclarations = pgTable(
  "conflict_declarations",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    hasConflict: boolean("has_conflict").notNull(),
    details: text("details").notNull().default(""),
    declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.studyId] })],
);

export const assignmentRole = pgEnum("assignment_role", ["primary_reviewer", "secondary_reviewer"]);
export const assignmentStatus = pgEnum("assignment_status", ["assigned", "completed", "withdrawn_conflict"]);
export const decision = pgEnum("decision", ["approve", "require_modifications", "disapprove", "refer_to_full_board"]);

export const reviewAssignments = pgTable(
  "review_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    role: assignmentRole("role").notNull(),
    status: assignmentStatus("status").notNull().default("assigned"),
    reason: text("reason").notNull().default(""),
    /** Answers to the 21 CFR 56.111 approval criteria. */
    answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes").notNull().default(""),
    decision: decision("decision"),
    explanation: text("explanation"),
    approvalMonths: integer("approval_months"),
    confirmsExpedited: boolean("confirms_expedited"),
    signatureId: uuid("signature_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("assignments_member_idx").on(t.memberId), index("assignments_submission_idx").on(t.submissionId)],
);

/** Letters to investigators, generated from decisions (21 CFR 56.109(e)). */
export const letters = pgTable("letters", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  bodyHash: text("body_hash").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
});
