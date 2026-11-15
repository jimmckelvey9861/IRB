import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  conflictDeclarations,
  letters,
  members,
  reviewAssignments,
  studies,
  submissions,
  users,
} from "@/db/schema";
import { checkConsentText, unresolvedElements, type ElementResolution } from "@/domain/consent";
import { isoToday } from "@/domain/roster";
import {
  APPROVAL_CRITERIA,
  proposePath,
  selectReviewers,
  validateDecision,
  type CandidateMember,
  type CriterionAnswer,
  type CriterionId,
  type Decision,
} from "@/domain/review";
import { recordAudit } from "./audit";
import type { User } from "./auth/service";
import { sha256 } from "./canonical";
import { signRecord } from "./esign";
import { PermissionError, requireRole } from "./members";
import { recordEarning } from "./pay";
import { reviewEarningKind } from "@/domain/earnings";

export const NewStudySchema = z.object({
  title: z.string().trim().min(5),
  sponsor: z.string().trim().min(2),
  expertise: z.array(z.string().trim().min(1)).default([]),
  summary: z.string().trim().min(20),
  protocolText: z.string().default(""),
  consentText: z.string().min(1, "Paste the consent form text."),
  minimalRisk: z.boolean(),
  expeditedCategory: z.number().int().min(1).max(9).nullable().default(null),
  applicableClinicalTrial: z.boolean(),
  involvesChildren: z.boolean(),
  involvesVulnerable: z.boolean(),
});
export type NewStudy = z.infer<typeof NewStudySchema>;

function addAudit(tx: Tx, actor: User, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown) {
  return recordAudit(tx, { actorUserId: actor.id, actorName: actor.fullName, action, entityType, entityId, after, before });
}

async function nextIrbNumber(tx: Tx): Promise<string> {
  const year = new Date().getUTCFullYear();
  const [{ n }] = await tx
    .select({ n: count() })
    .from(studies)
    .where(sql`${studies.irbNumber} like ${`IRB-${year}-%`}`);
  return `IRB-${year}-${String(n + 1).padStart(4, "0")}`;
}

/** An investigator registers a study and drafts its initial submission. */
export async function createStudyDraft(tx: Tx, actor: User, input: NewStudy) {
  requireRole(actor, "investigator", "administrator");
  const data = NewStudySchema.parse(input);
  await tx.execute(sql`select pg_advisory_xact_lock(4242002)`);
  const [study] = await tx
    .insert(studies)
    .values({
      irbNumber: await nextIrbNumber(tx),
      title: data.title,
      sponsor: data.sponsor,
      principalInvestigatorId: actor.id,
      expertise: data.expertise,
    })
    .returning();
  const [submission] = await tx
    .insert(submissions)
    .values({
      studyId: study.id,
      kind: "initial",
      submittedById: actor.id,
      summary: data.summary,
      protocolText: data.protocolText,
      consentText: data.consentText,
      minimalRisk: data.minimalRisk,
      expeditedCategory: data.minimalRisk ? data.expeditedCategory : null,
      applicableClinicalTrial: data.applicableClinicalTrial,
      involvesChildren: data.involvesChildren,
      involvesVulnerable: data.involvesVulnerable,
    })
    .returning();
  await addAudit(tx, actor, "study.created", "study", study.id, { irbNumber: study.irbNumber, title: study.title });
  await addAudit(tx, actor, "submission.drafted", "submission", submission.id, { studyId: study.id, kind: "initial" });
  return { study, submission };
}

export function consentCheckFor(sub: typeof submissions.$inferSelect) {
  return checkConsentText(sub.consentText, {
    greaterThanMinimalRisk: !sub.minimalRisk,
    applicableClinicalTrial: sub.applicableClinicalTrial,
  });
}

async function loadSubmission(tx: Tx, id: string) {
  const [row] = await tx
    .select({ submission: submissions, study: studies })
    .from(submissions)
    .innerJoin(studies, eq(studies.id, submissions.studyId))
    .where(eq(submissions.id, id))
    .limit(1);
  if (!row) throw new Error("Submission not found.");
  return row;
}

function canSeeSubmission(actor: User, study: typeof studies.$inferSelect) {
  return (
    actor.roles.some((r) => r === "administrator" || r === "chair" || r === "official" || r === "member") ||
    study.principalInvestigatorId === actor.id
  );
}

export async function getSubmissionForViewer(tx: Tx, actor: User, id: string) {
  const row = await loadSubmission(tx, id);
  if (!canSeeSubmission(actor, row.study)) throw new PermissionError("You do not have access to this submission.");
  return row;
}

/** Saves where unfound consent elements are covered, or why an additional element does not apply. */
export async function saveConsentResolutions(tx: Tx, actor: User, submissionId: string, resolutions: ElementResolution[]) {
  const { submission, study } = await loadSubmission(tx, submissionId);
  if (study.principalInvestigatorId !== actor.id && !actor.roles.includes("administrator")) {
    throw new PermissionError("Only the investigator can edit this submission.");
  }
  if (submission.status !== "draft") throw new Error("This submission has already been sent.");
  const clean = resolutions.filter((r) => r.location?.trim() || r.notApplicableBecause?.trim());
  await tx.update(submissions).set({ consentResolutions: clean }).where(eq(submissions.id, submissionId));
  await addAudit(tx, actor, "submission.consent_resolved", "submission", submissionId, { resolutions: clean });
}

/**
 * Sends a draft to the IRB. Blocks if the consent form is incomplete; otherwise picks the review path
 * and assigns reviewers immediately, so review starts without any staff involvement.
 */
export async function submitForReview(tx: Tx, actor: User, submissionId: string) {
  const { submission, study } = await loadSubmission(tx, submissionId);
  if (study.principalInvestigatorId !== actor.id && !actor.roles.includes("administrator")) {
    throw new PermissionError("Only the investigator can send this submission.");
  }
  if (submission.status !== "draft" && submission.status !== "modifications_required") {
    throw new Error("This submission is not waiting to be sent.");
  }
  const check = consentCheckFor(submission);
  const open = unresolvedElements(check, submission.consentResolutions as ElementResolution[]);
  if (open.length) {
    return { ok: false as const, missing: open.map((e) => `${e.cfr}: ${e.label}`) };
  }
  const { path, basis } = proposePath({
    kind: submission.kind,
    minimalRisk: submission.minimalRisk,
    expeditedCategory: submission.expeditedCategory,
    minorChange: submission.minorChange,
  });
  await tx
    .update(submissions)
    .set({ status: "in_review", path, pathBasis: basis, submittedAt: new Date() })
    .where(eq(submissions.id, submissionId));
  await addAudit(tx, actor, "submission.submitted", "submission", submissionId, { path, basis }, { status: submission.status });
  const assignment = await assignReviewers(tx, submissionId);
  return { ok: true as const, path, ...assignment };
}

async function candidateMembers(tx: Tx): Promise<CandidateMember[]> {
  const rows = await tx
    .select({ member: members, user: users })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId));
  const loads = await tx
    .select({ memberId: reviewAssignments.memberId, n: count() })
    .from(reviewAssignments)
    .where(eq(reviewAssignments.status, "assigned"))
    .groupBy(reviewAssignments.memberId);
  return rows.map(({ member, user }) => ({
    id: member.id,
    name: user.fullName,
    status: member.status,
    membershipType: member.membershipType,
    primaryConcern: member.primaryConcern,
    expertise: member.expertise,
    experiencedReviewer: member.experiencedReviewer,
    trainingCompletedOn: member.trainingCompletedOn,
    termEndsOn: member.termEndsOn,
    openAssignments: loads.find((l) => l.memberId === member.id)?.n ?? 0,
  }));
}

/** Fills any open reviewer roles, skipping conflicted members and anyone already asked. */
export async function assignReviewers(tx: Tx, submissionId: string) {
  const { submission, study } = await loadSubmission(tx, submissionId);
  if (!submission.path) throw new Error("Submission has no review path yet.");
  const existing = await tx.select().from(reviewAssignments).where(eq(reviewAssignments.submissionId, submissionId));
  const conflicts = await tx
    .select({ memberId: conflictDeclarations.memberId })
    .from(conflictDeclarations)
    .where(and(eq(conflictDeclarations.studyId, study.id), eq(conflictDeclarations.hasConflict, true)));
  const selection = selectReviewers(await candidateMembers(tx), {
    path: submission.path,
    studyExpertise: study.expertise,
    conflictedMemberIds: conflicts.map((c) => c.memberId),
    excludeMemberIds: existing.map((e) => e.memberId),
    today: isoToday(),
  });
  const filledRoles = new Set(existing.filter((e) => e.status !== "withdrawn_conflict").map((e) => e.role));
  const toAdd = selection.reviewers.filter((r) => !filledRoles.has(r.role));
  if (toAdd.length) {
    await tx.insert(reviewAssignments).values(
      toAdd.map((r) => ({ submissionId, memberId: r.memberId, role: r.role, reason: r.reason })),
    );
  }
  if (selection.consultantNeeded !== submission.consultantNeeded) {
    await tx.update(submissions).set({ consultantNeeded: selection.consultantNeeded }).where(eq(submissions.id, submissionId));
  }
  await recordAudit(tx, {
    actorUserId: null,
    actorName: "system",
    action: "submission.reviewers_assigned",
    entityType: "submission",
    entityId: submissionId,
    after: { added: toAdd, shortfall: selection.shortfall ?? null, consultantNeeded: selection.consultantNeeded },
  });
  return { assigned: toAdd, shortfall: selection.shortfall, consultantNeeded: selection.consultantNeeded };
}

async function memberFor(tx: Tx, actor: User) {
  const [m] = await tx.select().from(members).where(eq(members.userId, actor.id)).limit(1);
  if (!m) throw new PermissionError("You are not an IRB member.");
  return m;
}

async function loadAssignmentFor(tx: Tx, actor: User, assignmentId: string) {
  const member = await memberFor(tx, actor);
  const [a] = await tx.select().from(reviewAssignments).where(eq(reviewAssignments.id, assignmentId)).limit(1);
  if (!a || a.memberId !== member.id) throw new PermissionError("This review is not assigned to you.");
  const row = await loadSubmission(tx, a.submissionId);
  return { member, assignment: a, ...row };
}

export async function getAssignmentForReviewer(tx: Tx, actor: User, assignmentId: string) {
  const data = await loadAssignmentFor(tx, actor, assignmentId);
  const [declaration] = await tx
    .select()
    .from(conflictDeclarations)
    .where(and(eq(conflictDeclarations.memberId, data.member.id), eq(conflictDeclarations.studyId, data.study.id)))
    .limit(1);
  return { ...data, declaration: declaration ?? null };
}

/**
 * Before seeing a study, the reviewer declares whether they have a conflict (21 CFR 56.107(e)).
 * A conflicted reviewer is withdrawn and the system assigns someone else straight away.
 */
export async function declareConflict(tx: Tx, actor: User, assignmentId: string, hasConflict: boolean, details: string) {
  const { member, assignment, study } = await loadAssignmentFor(tx, actor, assignmentId);
  if (hasConflict && !details.trim()) throw new Error("Briefly describe the conflict.");
  await tx
    .insert(conflictDeclarations)
    .values({ memberId: member.id, studyId: study.id, hasConflict, details: details.trim() })
    .onConflictDoUpdate({
      target: [conflictDeclarations.memberId, conflictDeclarations.studyId],
      set: { hasConflict, details: details.trim(), declaredAt: new Date() },
    });
  await addAudit(tx, actor, "conflict.declared", "study", study.id, { memberId: member.id, hasConflict, details: details.trim() });
  if (hasConflict) {
    await tx.update(reviewAssignments).set({ status: "withdrawn_conflict" }).where(eq(reviewAssignments.id, assignment.id));
    await addAudit(tx, actor, "assignment.withdrawn_conflict", "submission", assignment.submissionId, { assignmentId: assignment.id });
    await assignReviewers(tx, assignment.submissionId);
  }
}

export interface ReviewInput {
  answers: Partial<Record<CriterionId, CriterionAnswer>>;
  notes: string;
  decision?: Decision;
  explanation?: string;
  approvalMonths?: number;
  confirmsExpeditedEligibility?: boolean;
  password: string;
}

/**
 * Completes a review and signs it.
 * - Expedited: the reviewer's signed decision is the IRB's decision; the letter goes out at once.
 * - Full board: the reviewer's signed assessment goes to the convened meeting, which decides (stage 2).
 */
export async function completeReview(tx: Tx, actor: User, assignmentId: string, input: ReviewInput) {
  const { member, assignment, submission, study } = await loadAssignmentFor(tx, actor, assignmentId);
  if (assignment.status !== "assigned") throw new Error("This review is already closed.");
  if (submission.status !== "in_review") throw new Error("This submission is not under review.");
  const [declaration] = await tx
    .select()
    .from(conflictDeclarations)
    .where(and(eq(conflictDeclarations.memberId, member.id), eq(conflictDeclarations.studyId, study.id)))
    .limit(1);
  if (!declaration || declaration.hasConflict) {
    throw new Error("Declare that you have no conflict of interest before reviewing.");
  }
  const path = submission.path!;
  const problems =
    path === "expedited"
      ? validateDecision({
          path,
          decision: input.decision ?? "approve",
          answers: input.answers,
          explanation: input.explanation,
          approvalMonths: input.approvalMonths,
          confirmsExpeditedEligibility: input.confirmsExpeditedEligibility,
        })
      : APPROVAL_CRITERIA.filter((c) => !input.answers[c.id]).length
        ? ["Answer every approval criterion before sending your assessment to the meeting."]
        : [];
  if (path === "expedited" && !input.decision) problems.push("Choose a decision.");
  if (problems.length) return { ok: false as const, problems };

  const record = {
    assignmentId,
    submissionId: submission.id,
    irbNumber: study.irbNumber,
    path,
    answers: input.answers,
    notes: input.notes,
    decision: path === "expedited" ? input.decision : null,
    explanation: input.explanation ?? null,
    approvalMonths: input.approvalMonths ?? null,
  };
  const signed = await signRecord(tx, {
    signerUserId: actor.id,
    password: input.password,
    meaning: path === "expedited" && input.decision !== "refer_to_full_board" ? "approval" : "review",
    entityType: "review_assignment",
    entityId: assignmentId,
    record,
  });
  if (!signed.ok) return { ok: false as const, problems: ["Password did not match; nothing was signed."] };

  await tx
    .update(reviewAssignments)
    .set({
      status: "completed",
      answers: input.answers,
      notes: input.notes,
      decision: path === "expedited" ? input.decision : null,
      explanation: input.explanation ?? null,
      approvalMonths: input.approvalMonths ?? null,
      confirmsExpedited: input.confirmsExpeditedEligibility ?? null,
      signatureId: signed.signature.id,
      completedAt: new Date(),
    })
    .where(eq(reviewAssignments.id, assignmentId));
  await addAudit(tx, actor, "review.completed", "submission", submission.id, { assignmentId, decision: record.decision });
  // Pay depends only on the work done (FDA IRB FAQ 8).
  await recordEarning(tx, member.id, reviewEarningKind({ path, role: assignment.role }), assignmentId);

  if (path === "expedited") {
    await applyExpeditedDecision(tx, actor, submission, study, input);
  } else {
    const open = await tx
      .select({ n: count() })
      .from(reviewAssignments)
      .where(and(eq(reviewAssignments.submissionId, submission.id), eq(reviewAssignments.status, "assigned")));
    if (open[0].n === 0) {
      await tx.update(submissions).set({ status: "awaiting_meeting" }).where(eq(submissions.id, submission.id));
      await addAudit(tx, actor, "submission.ready_for_meeting", "submission", submission.id, { status: "awaiting_meeting" });
    }
  }
  return { ok: true as const };
}

export function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function applyExpeditedDecision(
  tx: Tx,
  actor: User,
  submission: typeof submissions.$inferSelect,
  study: typeof studies.$inferSelect,
  input: ReviewInput,
) {
  if (input.decision === "refer_to_full_board") {
    await tx.update(submissions).set({ path: "full_board", pathBasis: "Referred to the full board by the expedited reviewer" }).where(eq(submissions.id, submission.id));
    await addAudit(tx, actor, "submission.referred_to_full_board", "submission", submission.id, { reason: input.explanation ?? "" });
    await assignReviewers(tx, submission.id);
    return;
  }
  await applyDecision(tx, actor, submission, study, {
    decision: input.decision === "approve" ? "approve" : "require_modifications",
    explanation: input.explanation ?? null,
    approvalMonths: input.approvalMonths ?? null,
    reviewType: `Expedited (${submission.pathBasis ?? "21 CFR 56.110"})`,
    decidedBy: `${actor.fullName}, designated IRB reviewer. This decision was electronically signed.`,
  });
}

export interface DecisionToApply {
  decision: "approve" | "require_modifications" | "disapprove";
  explanation: string | null;
  approvalMonths: number | null;
  reviewType: string;
  decidedBy: string;
}

/** Records an IRB decision on a submission and sends the investigator a written letter (21 CFR 56.109(e)). */
export async function applyDecision(
  tx: Tx,
  actor: User | null,
  submission: typeof submissions.$inferSelect,
  study: typeof studies.$inferSelect,
  d: DecisionToApply,
) {
  const status = d.decision === "approve" ? "approved" : d.decision === "disapprove" ? "disapproved" : "modifications_required";
  await tx.update(submissions).set({ status, decidedAt: new Date() }).where(eq(submissions.id, submission.id));
  let expires: string | null = null;
  if (d.decision === "approve") {
    expires = addMonths(isoToday(), d.approvalMonths!);
    await tx.update(studies).set({ approvalExpiresOn: expires }).where(eq(studies.id, study.id));
  }
  await recordAudit(tx, {
    actorUserId: actor?.id ?? null,
    actorName: actor?.fullName ?? "system",
    action: "submission.decided",
    entityType: "submission",
    entityId: submission.id,
    before: { status: submission.status },
    after: { status, approvalExpiresOn: expires },
  });

  const [pi] = await tx.select().from(users).where(eq(users.id, study.principalInvestigatorId)).limit(1);
  const kindLabel = submission.kind === "initial" ? "Initial review" : "Amendment";
  const subject = `${study.irbNumber}: ${d.decision === "approve" ? "Approved" : d.decision === "disapprove" ? "Disapproved" : "Modifications required"}`;
  const outcome =
    d.decision === "approve"
      ? `The IRB has approved this research. Approval is valid through ${expires}. Continuing review must be completed before that date or approval lapses and all research activity must stop (21 CFR 56.109(f)).`
      : d.decision === "disapprove"
        ? `The IRB has disapproved this research. The reasons are:\n\n${d.explanation}\n\nYou may respond in person or in writing (21 CFR 56.109(e)).`
        : `The IRB requires the following changes before the research can be approved. Please revise and resubmit:\n\n${d.explanation}`;
  const body = [
    `Date: ${isoToday()}`,
    `To: ${pi.fullName}, Principal Investigator`,
    `Study: ${study.title} (${study.irbNumber})`,
    `Sponsor: ${study.sponsor}`,
    `Submission: ${kindLabel}`,
    `Review type: ${d.reviewType}`,
    "",
    outcome,
    "",
    "You must promptly report to the IRB any unanticipated problems involving risks to subjects or others, and you may not make changes to the research without IRB approval except where necessary to eliminate apparent immediate hazards to subjects (21 CFR 56.108).",
    "",
    `Decided by: ${d.decidedBy}`,
  ].join("\n");
  const [letter] = await tx
    .insert(letters)
    .values({ submissionId: submission.id, subject, body, bodyHash: sha256(body) })
    .returning();
  await recordAudit(tx, {
    actorUserId: null,
    actorName: "system",
    action: "letter.issued",
    entityType: "submission",
    entityId: submission.id,
    after: { letterId: letter.id, subject, bodyHash: letter.bodyHash },
  });
  return letter;
}

export async function listSubmissionsFor(tx: Tx, actor: User) {
  const base = tx
    .select({ submission: submissions, study: studies })
    .from(submissions)
    .innerJoin(studies, eq(studies.id, submissions.studyId))
    .orderBy(desc(submissions.createdAt));
  const staff = actor.roles.some((r) => r !== "investigator");
  return staff ? base : base.where(eq(studies.principalInvestigatorId, actor.id));
}

export async function myAssignments(tx: Tx, actor: User) {
  const [m] = await tx.select().from(members).where(eq(members.userId, actor.id)).limit(1);
  if (!m) return [];
  return tx
    .select({ assignment: reviewAssignments, submission: submissions, study: studies })
    .from(reviewAssignments)
    .innerJoin(submissions, eq(submissions.id, reviewAssignments.submissionId))
    .innerJoin(studies, eq(studies.id, submissions.studyId))
    .where(and(eq(reviewAssignments.memberId, m.id), ne(reviewAssignments.status, "withdrawn_conflict")))
    .orderBy(desc(reviewAssignments.assignedAt));
}

export async function submissionDetail(tx: Tx, submissionId: string) {
  const assignments = await tx
    .select({ assignment: reviewAssignments, name: users.fullName })
    .from(reviewAssignments)
    .innerJoin(members, eq(members.id, reviewAssignments.memberId))
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(reviewAssignments.submissionId, submissionId));
  const issued = await tx.select().from(letters).where(eq(letters.submissionId, submissionId)).orderBy(desc(letters.issuedAt));
  return { assignments, letters: issued };
}

/** The chair designates which members may conduct expedited review (21 CFR 56.110(b); FDA IRB FAQ 20). */
export async function setExperiencedReviewer(tx: Tx, actor: User, memberId: string, value: boolean) {
  requireRole(actor, "chair");
  const [before] = await tx.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!before) throw new Error("Member not found.");
  await tx.update(members).set({ experiencedReviewer: value }).where(eq(members.id, memberId));
  await addAudit(tx, actor, "member.expedited_designation", "member", memberId, { experiencedReviewer: value }, { experiencedReviewer: before.experiencedReviewer });
}

