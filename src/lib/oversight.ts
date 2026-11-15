import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { eventReports, regulatoryReports, studies, submissions, users } from "@/db/schema";
import {
  approvalState,
  determinationProblems,
  EVENT_LABELS,
  REPORT_LABELS,
  requiredReports,
  type Determination,
  type EventKind,
  type RegulatoryReportKind,
} from "@/domain/oversight";
import { isoToday } from "@/domain/roster";
import { addMonthsIso } from "@/domain/training";
import { recordAudit } from "./audit";
import type { User } from "./auth/service";
import { sha256 } from "./canonical";
import { signRecord } from "./esign";
import { PermissionError, requireRole } from "./members";
import { notify, usersWithRole } from "./notify";
import { IRB_NAME } from "./meetings";

type Study = typeof studies.$inferSelect;

function audit(tx: Tx, actor: User | null, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown) {
  return recordAudit(tx, { actorUserId: actor?.id ?? null, actorName: actor?.fullName ?? "system", action, entityType, entityId, after, before });
}

const isStaff = (u: User) => u.roles.some((r) => r !== "investigator");

async function loadStudy(tx: Tx, studyId: string): Promise<Study> {
  const [s] = await tx.select().from(studies).where(eq(studies.id, studyId)).limit(1);
  if (!s) throw new Error("Study not found.");
  return s;
}

function requireStudyAccess(actor: User, study: Study) {
  if (!isStaff(actor) && study.principalInvestigatorId !== actor.id) {
    throw new PermissionError("You do not have access to this study.");
  }
}

// ---------------------------------------------------------------------------------------------
// Amendments and continuing review
// ---------------------------------------------------------------------------------------------

export const FollowOnSchema = z.object({
  kind: z.enum(["amendment", "continuing"]),
  summary: z.string().trim().min(20, "Describe the change or the progress since the last review (at least 20 characters)."),
  /** Leave empty to keep the currently approved consent form. */
  consentText: z.string().default(""),
  minimalRisk: z.boolean(),
  expeditedCategory: z.number().int().min(1).max(9).nullable().default(null),
  minorChange: z.boolean().default(false),
  progressReport: z
    .object({
      enrolledTotal: z.number().int().min(0),
      enrolledSinceLastReview: z.number().int().min(0),
      withdrawn: z.number().int().min(0),
      enrollmentOpen: z.boolean(),
      problemsSummary: z.string().default(""),
    })
    .nullable()
    .default(null),
});
export type FollowOn = z.input<typeof FollowOnSchema>;

const OPEN_STATUSES = ["draft", "in_review", "awaiting_meeting", "modifications_required"] as const;

/**
 * The investigator starts an amendment (a change to approved research, which may not begin until
 * approved: 21 CFR 56.108(a)(4)) or a continuing review (the yearly re-review: 56.109(f)).
 */
export async function createFollowOnSubmission(tx: Tx, actor: User, studyId: string, input: FollowOn) {
  const study = await loadStudy(tx, studyId);
  if (study.principalInvestigatorId !== actor.id && !actor.roles.includes("administrator")) {
    throw new PermissionError("Only the study's investigator can do this.");
  }
  const data = FollowOnSchema.parse(input);
  if (study.status === "terminated" || study.status === "closed") throw new Error(`This study is ${study.status}.`);
  if (!study.approvalExpiresOn) throw new Error("The study has not been approved yet; finish the initial review first.");
  if (data.kind === "continuing" && study.status === "suspended") {
    throw new Error("Approval is suspended. Submit an amendment that addresses the IRB's concerns first.");
  }
  if (data.kind === "continuing" && !data.progressReport) throw new Error("A continuing review needs a progress report.");

  const all = await tx.select().from(submissions).where(eq(submissions.studyId, studyId)).orderBy(desc(submissions.createdAt));
  if (all.some((s) => s.kind === data.kind && (OPEN_STATUSES as readonly string[]).includes(s.status))) {
    throw new Error(`There is already an open ${data.kind === "continuing" ? "continuing review" : "amendment"} for this study.`);
  }
  const base = all.find((s) => s.status === "approved") ?? all[0];
  const consentText = data.consentText.trim() ? data.consentText : base.consentText;
  const [submission] = await tx
    .insert(submissions)
    .values({
      studyId,
      kind: data.kind,
      submittedById: actor.id,
      summary: data.summary,
      protocolText: base.protocolText,
      consentText,
      // The consent check notes carry over only when the consent form itself is unchanged.
      consentResolutions: consentText === base.consentText ? base.consentResolutions : [],
      minimalRisk: data.minimalRisk,
      expeditedCategory: data.expeditedCategory,
      minorChange: data.kind === "amendment" && data.minorChange,
      applicableClinicalTrial: base.applicableClinicalTrial,
      involvesChildren: base.involvesChildren,
      involvesVulnerable: base.involvesVulnerable,
      progressReport: data.progressReport,
    })
    .returning();
  await audit(tx, actor, "submission.drafted", "submission", submission.id, { studyId, kind: data.kind, progressReport: data.progressReport });
  return submission;
}

// ---------------------------------------------------------------------------------------------
// Daily sweep: renewal reminders and lapses
// ---------------------------------------------------------------------------------------------

/**
 * Run once a day (and safely more often). Reminds investigators 60, 30, 14, 7 and 1 days before
 * approval ends, and marks a study lapsed the day after, which tells the investigator to stop all
 * research activity (21 CFR 56.109(f); FDA guidance on continuing review, 2012).
 */
export async function runOversightSweep(tx: Tx, today = isoToday()) {
  const rows = await tx
    .select()
    .from(studies)
    .where(and(eq(studies.status, "active"), isNotNull(studies.approvalExpiresOn)));
  const chairs = await usersWithRole(tx, "chair");
  let reminded = 0;
  const lapsed: string[] = [];
  for (const s of rows) {
    const st = approvalState(s.approvalExpiresOn, today);
    if (st.state === "current" && st.remindToday) {
      reminded += await notify(tx, [s.principalInvestigatorId], {
        subject: `${s.irbNumber}: approval ends in ${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"}`,
        body: `Approval for "${s.title}" is valid through ${s.approvalExpiresOn}. Submit the continuing review now so the board can decide in time.`,
        link: `/studies/${s.id}`,
        dedupeKey: `renewal:${s.id}:${s.approvalExpiresOn}:${st.daysLeft}`,
      });
    }
    if (st.state === "lapsed") {
      await tx.update(studies).set({ status: "lapsed" }).where(eq(studies.id, s.id));
      await audit(tx, null, "study.approval_lapsed", "study", s.id, { status: "lapsed", expiredOn: s.approvalExpiresOn }, { status: s.status });
      await notify(tx, [s.principalInvestigatorId, ...chairs], {
        subject: `${s.irbNumber}: approval has lapsed. Stop all research activity`,
        body: `Approval ended on ${s.approvalExpiresOn}. No new enrollment and no research procedures may happen until the IRB approves a continuing review. If stopping would harm subjects already enrolled, tell the IRB at once so it can decide whether they may continue.`,
        link: `/studies/${s.id}`,
        dedupeKey: `lapsed:${s.id}:${s.approvalExpiresOn}`,
      });
      lapsed.push(s.irbNumber);
    }
  }
  return { reminded, lapsed };
}

// ---------------------------------------------------------------------------------------------
// Problem reports
// ---------------------------------------------------------------------------------------------

export const EventReportSchema = z.object({
  kind: z.enum(Object.keys(EVENT_LABELS) as [EventKind, ...EventKind[]]),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date it happened."),
  description: z.string().trim().min(20, "Describe what happened (at least 20 characters)."),
});
export type EventReportInput = z.infer<typeof EventReportSchema>;

/** Anyone involved with the study can report a problem; the chair is told immediately. */
export async function fileEventReport(tx: Tx, actor: User, studyId: string, input: EventReportInput) {
  const study = await loadStudy(tx, studyId);
  requireStudyAccess(actor, study);
  const data = EventReportSchema.parse(input);
  if (data.occurredOn > isoToday()) throw new Error("The date cannot be in the future.");
  const [report] = await tx
    .insert(eventReports)
    .values({ studyId, reportedById: actor.id, kind: data.kind, occurredOn: data.occurredOn, description: data.description })
    .returning();
  await audit(tx, actor, "event.reported", "event_report", report.id, { studyId, ...data });
  await notify(tx, await usersWithRole(tx, "chair"), {
    subject: `${study.irbNumber}: ${EVENT_LABELS[data.kind].toLowerCase()} reported`,
    body: "A determination is needed.",
    link: `/studies/${studyId}#event-${report.id}`,
  });
  return report;
}

const DeterminationSchema = z.object({
  isUnanticipatedProblem: z.boolean(),
  noncompliance: z.enum(["none", "minor", "serious", "continuing"]),
  action: z.enum(["none", "require_modifications", "suspend", "terminate"]),
  rationale: z.string(),
});

/**
 * The chair or a designated member decides what the report means and signs the finding. The
 * system then drafts every report the finding requires, for the organizational official to sign.
 */
export async function determineEvent(tx: Tx, actor: User, eventId: string, input: Determination, password: string) {
  requireRole(actor, "chair", "member");
  const d = DeterminationSchema.parse(input);
  const [event] = await tx.select().from(eventReports).where(eq(eventReports.id, eventId)).limit(1);
  if (!event) throw new Error("Report not found.");
  if (event.status === "determined") throw new Error("A determination has already been made.");
  const study = await loadStudy(tx, event.studyId);
  if (study.principalInvestigatorId === actor.id) throw new PermissionError("You cannot make a determination on your own study.");
  const by = actor.roles.includes("chair") ? "chair" : "reviewer";
  const problems = determinationProblems(d, by);
  if (problems.length) return { ok: false as const, problems };

  const sig = await signRecord(tx, {
    signerUserId: actor.id,
    password,
    meaning: "review",
    entityType: "event_report",
    entityId: eventId,
    record: { eventId, kind: event.kind, description: event.description, determination: d },
  });
  if (!sig.ok) return { ok: false as const, problems: [sig.reason === "locked" ? "Your account is locked." : "Password incorrect."] };

  await tx
    .update(eventReports)
    .set({ status: "determined", determination: d, determinedById: actor.id, determinedAt: new Date(), signatureId: sig.signature.id })
    .where(eq(eventReports.id, eventId));
  await audit(tx, actor, "event.determined", "event_report", eventId, { determination: d, signatureId: sig.signature.id });

  const newStatus = d.action === "suspend" ? "suspended" : d.action === "terminate" ? "terminated" : null;
  if (newStatus) {
    await tx.update(studies).set({ status: newStatus }).where(eq(studies.id, study.id));
    await audit(tx, actor, `study.${newStatus}`, "study", study.id, { status: newStatus, eventId }, { status: study.status });
  }

  const [pi] = await tx.select().from(users).where(eq(users.id, study.principalInvestigatorId)).limit(1);
  const drafts = [];
  for (const kind of requiredReports(d)) {
    const body = draftReport(kind, study, pi.fullName, event, d);
    const [r] = await tx
      .insert(regulatoryReports)
      .values({ eventReportId: eventId, kind, recipients: RECIPIENTS, body, bodyHash: sha256(body) })
      .returning();
    drafts.push(r);
    await audit(tx, null, "regulatory_report.drafted", "regulatory_report", r.id, { kind, eventId, bodyHash: r.bodyHash });
  }
  if (drafts.length) {
    await notify(tx, await usersWithRole(tx, "official"), {
      subject: `${study.irbNumber}: ${drafts.length} report${drafts.length > 1 ? "s" : ""} to sign and send`,
      body: drafts.map((r) => REPORT_LABELS[r.kind]).join("; "),
      link: `/studies/${study.id}#event-${eventId}`,
    });
  }
  const outcome =
    d.action === "suspend"
      ? "IRB approval is suspended. Stop enrolling and stop research procedures except where stopping would harm enrolled subjects."
      : d.action === "terminate"
        ? "IRB approval is terminated. Stop the research except where stopping would harm enrolled subjects."
        : d.action === "require_modifications"
          ? "The IRB requires changes. Submit an amendment."
          : "No further action is required.";
  await notify(tx, [study.principalInvestigatorId], { subject: `${study.irbNumber}: IRB determination on your report`, body: outcome, link: `/studies/${study.id}#event-${eventId}` });
  return { ok: true as const, reports: drafts };
}

const RECIPIENTS = "Principal investigator; Organizational official; FDA (Office of Good Clinical Practice); sponsor";

function draftReport(
  kind: RegulatoryReportKind,
  study: Study,
  piName: string,
  event: typeof eventReports.$inferSelect,
  d: Determination,
): string {
  const urgent = d.action === "suspend" || d.action === "terminate";
  return [
    `Report of ${REPORT_LABELS[kind].toLowerCase()} (21 CFR 56.108(b)${kind === "suspension" || kind === "termination" ? ", 56.113" : ""})`,
    "",
    `From: ${IRB_NAME}`,
    `To: ${RECIPIENTS}`,
    `Date: ${isoToday()}`,
    "",
    `Study: ${study.title} (${study.irbNumber})`,
    `Sponsor: ${study.sponsor}`,
    `Principal investigator: ${piName}`,
    "",
    `What happened (reported ${event.createdAt.toISOString().slice(0, 10)}, occurred ${event.occurredOn}):`,
    event.description,
    "",
    "IRB finding:",
    `- Unanticipated problem involving risks to subjects or others: ${d.isUnanticipatedProblem ? "yes" : "no"}`,
    `- Noncompliance: ${d.noncompliance}`,
    `- Action: ${d.action.replace("_", " ")}`,
    "",
    "Reasons:",
    d.rationale,
    "",
    urgent
      ? "This action was taken by the IRB chair to protect subjects and will be reviewed by the convened board at its next meeting."
      : "The IRB will tell the recipients of any further action.",
  ].join("\n");
}

/** The organizational official signs a drafted report, which records that it is ready to send. */
export async function signRegulatoryReport(tx: Tx, actor: User, reportId: string, password: string) {
  requireRole(actor, "official");
  const [r] = await tx.select().from(regulatoryReports).where(eq(regulatoryReports.id, reportId)).limit(1);
  if (!r) throw new Error("Report not found.");
  if (r.status === "signed") throw new Error("This report has already been signed.");
  const sig = await signRecord(tx, {
    signerUserId: actor.id,
    password,
    meaning: "responsibility",
    entityType: "regulatory_report",
    entityId: reportId,
    record: { reportId, kind: r.kind, bodyHash: r.bodyHash },
  });
  if (!sig.ok) return { ok: false as const, problem: sig.reason === "locked" ? "Your account is locked." : "Password incorrect." };
  await tx
    .update(regulatoryReports)
    .set({ status: "signed", signedById: actor.id, signatureId: sig.signature.id, signedAt: new Date() })
    .where(eq(regulatoryReports.id, reportId));
  await audit(tx, actor, "regulatory_report.signed", "regulatory_report", reportId, { signatureId: sig.signature.id });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------------------------
// Closing a study
// ---------------------------------------------------------------------------------------------

/**
 * The investigator closes a study when all research activity, including follow-up and analysis of
 * identifiable data, has ended. Records must then be kept at least 3 years (21 CFR 56.115(b)).
 */
export async function closeStudy(tx: Tx, actor: User, studyId: string, finalReport: string) {
  const study = await loadStudy(tx, studyId);
  if (study.principalInvestigatorId !== actor.id && !actor.roles.includes("chair")) {
    throw new PermissionError("Only the study's investigator or the chair can close a study.");
  }
  if (study.status === "closed") throw new Error("This study is already closed.");
  if (finalReport.trim().length < 20) throw new Error("Write a short final report: how many took part, and any problems not yet reported.");
  const open = await tx.select().from(submissions).where(eq(submissions.studyId, studyId));
  if (open.some((s) => (OPEN_STATUSES as readonly string[]).includes(s.status) && s.status !== "draft")) {
    throw new Error("A submission for this study is still under review.");
  }
  const pending = await tx.select().from(eventReports).where(and(eq(eventReports.studyId, studyId), eq(eventReports.status, "awaiting_determination")));
  if (pending.length) throw new Error("A problem report for this study still needs a determination.");
  const retainUntil = addMonthsIso(isoToday(), 36);
  await tx.update(studies).set({ status: "closed", retainUntil }).where(eq(studies.id, studyId));
  await audit(tx, actor, "study.closed", "study", studyId, { status: "closed", retainUntil, finalReport: finalReport.trim() }, { status: study.status });
  await notify(tx, await usersWithRole(tx, "chair"), { subject: `${study.irbNumber} closed`, body: finalReport.trim().slice(0, 200), link: `/studies/${studyId}` });
  return retainUntil;
}

// ---------------------------------------------------------------------------------------------
// Study page
// ---------------------------------------------------------------------------------------------

export async function studyOversight(tx: Tx, actor: User, studyId: string) {
  const study = await loadStudy(tx, studyId);
  requireStudyAccess(actor, study);
  const subs = await tx.select().from(submissions).where(eq(submissions.studyId, studyId)).orderBy(desc(submissions.createdAt));
  const events = await tx.select().from(eventReports).where(eq(eventReports.studyId, studyId)).orderBy(desc(eventReports.createdAt));
  const reports =
    isStaff(actor) && events.length
      ? await tx
          .select()
          .from(regulatoryReports)
          .where(inArray(regulatoryReports.eventReportId, events.map((e) => e.id)))
          .orderBy(regulatoryReports.createdAt, regulatoryReports.kind)
      : [];
  return { study, approval: approvalState(study.approvalExpiresOn, isoToday()), submissions: subs, events, reports };
}
