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

/**
 * - lapsed: approval expired before continuing review (21 CFR 56.109(f)); research must stop
 * - suspended / terminated: the IRB withdrew approval (21 CFR 56.113)
 */
export const studyStatus = pgEnum("study_status", ["active", "closed", "lapsed", "suspended", "terminated"]);

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

export const submissionKind = pgEnum("submission_kind", ["initial", "amendment", "continuing"]);
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
    /** Continuing review only: the investigator's progress report (enrollment, withdrawals, problems). */
    progressReport: jsonb("progress_report"),
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

// ---------------------------------------------------------------------------------------------
// Stage 2: convened meetings, availability, member pay
// ---------------------------------------------------------------------------------------------

export const meetingStatus = pgEnum("meeting_status", ["scheduled", "in_progress", "adjourned", "cancelled"]);

export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
  scheduledEnd: timestamp("scheduled_end", { withTimezone: true }).notNull(),
  /** Link to the HIPAA-eligible video service. */
  videoLink: text("video_link").notNull().default(""),
  status: meetingStatus("status").notNull().default("scheduled"),
  chairMemberId: uuid("chair_member_id").references(() => members.id),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  minutes: text("minutes"),
  minutesHash: text("minutes_hash"),
  minutesSignatureId: uuid("minutes_signature_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceMode = pgEnum("attendance_mode", ["in_person", "video", "phone"]);

export const meetingAttendance = pgTable(
  "meeting_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    mode: attendanceMode("mode").notNull(),
    /** Alternates: the absent primary whose seat they fill. */
    replacingMemberId: uuid("replacing_member_id").references(() => members.id),
    /** The member confirmed they received and reviewed the materials (FDA IRB FAQ 14). */
    hasMaterials: boolean("has_materials").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [index("attendance_meeting_idx").on(t.meetingId)],
);

export const itemStatus = pgEnum("item_status", ["pending", "voting", "decided", "tabled"]);
export const motion = pgEnum("motion", ["approve", "require_modifications", "disapprove", "table"]);

export const meetingItems = pgTable(
  "meeting_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    position: integer("position").notNull(),
    status: itemStatus("status").notNull().default("pending"),
    motion: motion("motion"),
    answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
    explanation: text("explanation"),
    controvertedIssues: text("controverted_issues"),
    approvalMonths: integer("approval_months"),
    childrenCategory: text("children_category"),
    votesFor: integer("votes_for"),
    votesAgainst: integer("votes_against"),
    votesAbstain: integer("votes_abstain"),
    votingPresent: integer("voting_present"),
    passed: boolean("passed"),
    /** Every motion put to a vote on this item, including failed ones (AAHRPP II.5.B). */
    motionHistory: jsonb("motion_history").notNull().default(sql`'[]'::jsonb`),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("items_meeting_idx").on(t.meetingId)],
);

export const itemRecusals = pgTable(
  "item_recusals",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => meetingItems.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    reason: text("reason").notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.memberId] })],
);

export const voteValue = pgEnum("vote_value", ["for", "against", "abstain"]);

export const votes = pgTable(
  "votes",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => meetingItems.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    vote: voteValue("vote").notNull(),
    castAt: timestamp("cast_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.memberId] })],
);

/** Times a member is free for a meeting; on-call windows earn the availability stipend. */
export const availability = pgTable(
  "availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    onCall: boolean("on_call").notNull().default(false),
    stipendRecorded: boolean("stipend_recorded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("availability_member_idx").on(t.memberId)],
);

export const earningKind = pgEnum("earning_kind", [
  "expedited_review",
  "full_board_primary_review",
  "full_board_secondary_review",
  "meeting_attendance",
  "on_call_hour",
]);

export const payRates = pgTable("pay_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: earningKind("kind").notNull(),
  amountCents: integer("amount_cents").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
});

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodEnd: date("period_end").notNull(),
  totalCents: integer("total_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per paid piece of work. Never tied to a decision (FDA IRB FAQ 8). */
export const earnings = pgTable(
  "earnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    kind: earningKind("kind").notNull(),
    /** What was done: a review assignment, meeting, or availability window id. */
    refId: uuid("ref_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    amountCents: integer("amount_cents").notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
    periodEnd: date("period_end").notNull(),
    payoutId: uuid("payout_id").references(() => payouts.id),
  },
  (t) => [
    uniqueIndex("earnings_once_per_work").on(t.memberId, t.kind, t.refId),
    index("earnings_member_idx").on(t.memberId),
  ],
);


// ---------------------------------------------------------------------------------------------
// Stage 2: ongoing oversight (problem reports, regulatory reports, notifications)
// ---------------------------------------------------------------------------------------------

export const eventKind = pgEnum("event_kind", [
  "unanticipated_problem",
  "adverse_event",
  "protocol_deviation",
  "noncompliance",
  "complaint",
  "other",
]);
export const eventStatus = pgEnum("event_status", ["awaiting_determination", "determined"]);

/** Something reported to the IRB about an approved study (21 CFR 56.108(b), 56.113; AAHRPP II.2.G). */
export const eventReports = pgTable(
  "event_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    reportedById: uuid("reported_by_id")
      .notNull()
      .references(() => users.id),
    kind: eventKind("kind").notNull(),
    occurredOn: date("occurred_on").notNull(),
    description: text("description").notNull(),
    status: eventStatus("status").notNull().default("awaiting_determination"),
    /** The IRB's finding: { isUnanticipatedProblem, noncompliance, action, rationale }. */
    determination: jsonb("determination"),
    determinedById: uuid("determined_by_id").references(() => users.id),
    determinedAt: timestamp("determined_at", { withTimezone: true }),
    signatureId: uuid("signature_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_reports_study_idx").on(t.studyId)],
);

export const regulatoryReportKind = pgEnum("regulatory_report_kind", [
  "unanticipated_problem",
  "serious_noncompliance",
  "continuing_noncompliance",
  "suspension",
  "termination",
]);
export const regulatoryReportStatus = pgEnum("regulatory_report_status", ["draft", "signed"]);

/** A report the IRB must promptly send to the investigator, the institution and FDA (21 CFR 56.108(b)). */
export const regulatoryReports = pgTable("regulatory_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventReportId: uuid("event_report_id")
    .notNull()
    .references(() => eventReports.id),
  kind: regulatoryReportKind("kind").notNull(),
  recipients: text("recipients").notNull(),
  body: text("body").notNull(),
  bodyHash: text("body_hash").notNull(),
  status: regulatoryReportStatus("status").notNull().default("draft"),
  signedById: uuid("signed_by_id").references(() => users.id),
  signatureId: uuid("signature_id"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** In-app notices. dedupeKey stops the daily sweep from repeating a reminder. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    subject: text("subject").notNull(),
    body: text("body").notNull().default(""),
    link: text("link").notNull().default(""),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("notifications_user_idx").on(t.userId), uniqueIndex("notifications_dedupe").on(t.userId, t.dedupeKey)],
);

// ---------------------------------------------------------------------------------------------
// Stage 3: policies, training, complaints, quality review
// ---------------------------------------------------------------------------------------------

/** A written procedure (SOP). Its text lives in versions; only one version is in effect at a time. */
export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  sources: text("sources").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const policyVersionStatus = pgEnum("policy_version_status", ["draft", "in_effect", "superseded"]);

export const policyVersions = pgTable(
  "policy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    bodyHash: text("body_hash").notNull(),
    changeSummary: text("change_summary").notNull().default(""),
    status: policyVersionStatus("status").notNull().default("draft"),
    draftedById: uuid("drafted_by_id").references(() => users.id),
    approvedById: uuid("approved_by_id").references(() => users.id),
    signatureId: uuid("signature_id"),
    effectiveFrom: date("effective_from"),
    /** AAHRPP expects policies to be reviewed periodically; we use yearly. */
    reviewDueOn: date("review_due_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("policy_versions_unique").on(t.policyId, t.version)],
);

/** A person confirms they have read a version in effect. */
export const policyAcknowledgments = pgTable(
  "policy_acknowledgments",
  {
    versionId: uuid("version_id")
      .notNull()
      .references(() => policyVersions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.userId] })],
);

/** A completed course. Kept permanently as evidence of qualification. */
export const trainingRecords = pgTable(
  "training_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    course: text("course").notNull(),
    completedOn: date("completed_on").notNull(),
    expiresOn: date("expires_on"),
    /** Certificate number, provider, or other evidence. */
    evidence: text("evidence").notNull().default(""),
    recordedById: uuid("recorded_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("training_user_idx").on(t.userId)],
);

export const complaintStatus = pgEnum("complaint_status", ["open", "responded", "referred"]);

/** A complaint, question or concern from a participant or anyone else (AAHRPP I-4). */
export const complaints = pgTable("complaints", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Short code given to the person so they can follow up without an account. */
  reference: text("reference").notNull().unique(),
  studyReference: text("study_reference").notNull().default(""),
  studyId: uuid("study_id").references(() => studies.id),
  fromRole: text("from_role").notNull(),
  message: text("message").notNull(),
  contactName: text("contact_name").notNull().default(""),
  contactDetail: text("contact_detail").notNull().default(""),
  status: complaintStatus("status").notNull().default("open"),
  response: text("response"),
  respondedById: uuid("responded_by_id").references(() => users.id),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  eventReportId: uuid("event_report_id").references(() => eventReports.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The quarterly quality review, signed by the reviewer (AAHRPP I-5). */
export const qaReviews = pgTable("qa_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  metrics: jsonb("metrics").notNull(),
  findings: text("findings").notNull(),
  actions: text("actions").notNull(),
  signedById: uuid("signed_by_id")
    .notNull()
    .references(() => users.id),
  signatureId: uuid("signature_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailStatus = pgEnum("email_status", ["queued", "sent", "failed"]);

/** Email copies of notices, sent by the worker. Notices carry no participant information. */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id").references(() => notifications.id),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: emailStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("email_outbox_status_idx").on(t.status)],
);

/** Organization-wide settings the official controls. Every change is audited. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
