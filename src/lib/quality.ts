import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  auditEvents,
  complaints,
  eventReports,
  meetingItems,
  meetings,
  policyVersions,
  qaReviews,
  regulatoryReports,
  reviewAssignments,
  studies,
  submissions,
} from "@/db/schema";
import { isoToday } from "@/domain/roster";
import { verifyAuditChain } from "./audit";
import type { User } from "./auth/service";
import { signRecord } from "./esign";
import { requireRole } from "./members";
import { trainingMatrix } from "./training";

/** Targets the dashboard measures against. They are stated in the SOPs. */
export const TARGETS = {
  expeditedHours: 24,
  reviewOpenDays: 3,
  determinationDays: 7,
  reportSignDays: 7,
  complaintDays: 7,
} as const;

const DAY = 86_400_000;
const startOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const afterEnd = (iso: string) => new Date(startOf(iso).getTime() + DAY);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const hours = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 10) / 10;

export type QualityMetrics = Awaited<ReturnType<typeof qualityMetrics>>;

/**
 * The numbers for the quality dashboard and the quarterly review (AAHRPP Standard I-5). Period
 * figures cover [from, to]; "now" figures are the backlog as of today.
 */
export async function qualityMetrics(tx: Tx, from: string, to: string, now = new Date()) {
  const decided = await tx
    .select()
    .from(submissions)
    .where(and(gte(submissions.decidedAt, startOf(from)), lt(submissions.decidedAt, afterEnd(to))));
  const turnaround = (path: "expedited" | "full_board") => {
    const hs = decided.filter((s) => s.path === path && s.submittedAt && s.decidedAt).map((s) => hours(s.submittedAt!, s.decidedAt!));
    return { decided: hs.length, medianHours: median(hs), slowestHours: hs.length ? Math.max(...hs) : null };
  };
  const outcomes = {
    approved: decided.filter((s) => s.status === "approved").length,
    modificationsRequired: decided.filter((s) => s.status === "modifications_required").length,
    disapproved: decided.filter((s) => s.status === "disapproved").length,
  };

  const older = (days: number) => new Date(now.getTime() - days * DAY);
  const overdueReviews = (
    await tx.select().from(reviewAssignments).where(and(eq(reviewAssignments.status, "assigned"), lt(reviewAssignments.assignedAt, older(TARGETS.reviewOpenDays))))
  ).length;
  const overdueDeterminations = (
    await tx.select().from(eventReports).where(and(eq(eventReports.status, "awaiting_determination"), lt(eventReports.createdAt, older(TARGETS.determinationDays))))
  ).length;
  const overdueReports = (
    await tx.select().from(regulatoryReports).where(and(eq(regulatoryReports.status, "draft"), lt(regulatoryReports.createdAt, older(TARGETS.reportSignDays))))
  ).length;

  const periodMeetings = await tx
    .select()
    .from(meetings)
    .where(and(eq(meetings.status, "adjourned"), gte(meetings.startedAt, startOf(from)), lt(meetings.startedAt, afterEnd(to))));
  const items = periodMeetings.length
    ? (await tx.select().from(meetingItems)).filter((i) => periodMeetings.some((m) => m.id === i.meetingId))
    : [];

  const lapses = (
    await tx
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "study.approval_lapsed"), gte(auditEvents.occurredAt, startOf(from)), lt(auditEvents.occurredAt, afterEnd(to))))
  ).length;
  const nowLapsed = (await tx.select().from(studies).where(eq(studies.status, "lapsed"))).length;

  const received = await tx.select().from(complaints).where(and(gte(complaints.receivedAt, startOf(from)), lt(complaints.receivedAt, afterEnd(to))));
  const openComplaintsOverdue = (
    await tx.select().from(complaints).where(and(eq(complaints.status, "open"), lt(complaints.receivedAt, older(TARGETS.complaintDays))))
  ).length;

  const today = isoToday();
  const reviewers = (await trainingMatrix(tx, today)).filter((r) => r.user.roles.some((x) => x === "member" || x === "chair"));
  const untrained = reviewers.filter((r) => r.status.some((s) => s.state !== "current")).map((r) => r.user.fullName);

  const inEffect = await tx.select().from(policyVersions).where(eq(policyVersions.status, "in_effect"));
  const chain = await verifyAuditChain(tx);

  return {
    period: { from, to },
    expedited: turnaround("expedited"),
    fullBoard: turnaround("full_board"),
    outcomes,
    backlog: { overdueReviews, overdueDeterminations, overdueReports, openComplaintsOverdue, lapsedStudies: nowLapsed },
    meetings: {
      held: periodMeetings.length,
      itemsDecided: items.filter((i) => i.status === "decided").length,
      itemsTabled: items.filter((i) => i.status === "tabled").length,
    },
    lapsesInPeriod: lapses,
    complaintsReceived: received.length,
    training: { reviewers: reviewers.length, notCurrent: untrained },
    policies: {
      inEffect: inEffect.length,
      reviewOverdue: inEffect.filter((v) => v.reviewDueOn && v.reviewDueOn < today).length,
    },
    auditTrail: { ok: chain.ok, entries: chain.entries },
  };
}

/** Plain-language flags for anything that missed its target. */
export function qualityFlags(m: QualityMetrics): string[] {
  const f: string[] = [];
  if (m.expedited.medianHours !== null && m.expedited.medianHours > TARGETS.expeditedHours) f.push(`Expedited reviews took a median of ${m.expedited.medianHours} hours; the target is ${TARGETS.expeditedHours}.`);
  if (m.backlog.overdueReviews) f.push(`${m.backlog.overdueReviews} review(s) open longer than ${TARGETS.reviewOpenDays} days.`);
  if (m.backlog.overdueDeterminations) f.push(`${m.backlog.overdueDeterminations} problem report(s) waiting more than ${TARGETS.determinationDays} days for a determination.`);
  if (m.backlog.overdueReports) f.push(`${m.backlog.overdueReports} regulatory report(s) unsigned for more than ${TARGETS.reportSignDays} days.`);
  if (m.backlog.openComplaintsOverdue) f.push(`${m.backlog.openComplaintsOverdue} concern(s) unanswered for more than ${TARGETS.complaintDays} days.`);
  if (m.backlog.lapsedStudies) f.push(`${m.backlog.lapsedStudies} study(ies) currently lapsed.`);
  if (m.training.notCurrent.length) f.push(`Training not current: ${m.training.notCurrent.join(", ")}.`);
  if (m.policies.reviewOverdue) f.push(`${m.policies.reviewOverdue} policy(ies) past their yearly review.`);
  if (m.policies.inEffect === 0) f.push("No written policies are in effect yet.");
  if (!m.auditTrail.ok) f.push("The audit trail failed its integrity check.");
  return f;
}

const QaReviewSchema = z.object({
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  findings: z.string().trim().min(10, "Record what the review found."),
  actions: z.string().trim().min(2, "Record the actions agreed, or 'None'."),
});

/** The chair or official signs the quarterly review; the metrics are frozen into the record. */
export async function signQaReview(tx: Tx, actor: User, input: z.input<typeof QaReviewSchema>, password: string) {
  requireRole(actor, "chair", "official");
  const data = QaReviewSchema.parse(input);
  if (data.periodEnd < data.periodStart) throw new Error("The period ends before it starts.");
  const metrics = await qualityMetrics(tx, data.periodStart, data.periodEnd);
  const id = randomUUID();
  const sig = await signRecord(tx, {
    signerUserId: actor.id,
    password,
    meaning: "review",
    entityType: "qa_review",
    entityId: id,
    record: { ...data, metrics },
  });
  if (!sig.ok) return { ok: false as const, problem: sig.reason === "locked" ? "Your account is locked." : "Password incorrect." };
  const [r] = await tx.insert(qaReviews).values({ id, ...data, metrics, signedById: actor.id, signatureId: sig.signature.id }).returning();
  return { ok: true as const, review: r };
}

export function listQaReviews(tx: Tx) {
  return tx.select().from(qaReviews).orderBy(desc(qaReviews.periodEnd));
}

/** The calendar quarter before the one containing today. */
export function previousQuarter(today = isoToday()): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const [py, pq] = q === 0 ? [y - 1, 3] : [y, q - 1];
  const from = `${py}-${String(pq * 3 + 1).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(py, pq * 3 + 3, 0));
  return { from, to: end.toISOString().slice(0, 10) };
}

