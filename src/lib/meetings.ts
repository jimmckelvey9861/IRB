import { and, asc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  alternateFor,
  availability,
  conflictDeclarations,
  itemRecusals,
  meetingAttendance,
  meetingItems,
  meetings,
  members,
  studies,
  submissions,
  users,
  votes,
} from "@/db/schema";
import { countSeats, findEarliestSlot, tally, type Presence, type SeatMember, type VoteValue } from "@/domain/meeting";
import { generateMinutes, type MinutesItem } from "@/domain/minutes";
import { validateDecision, type CriterionAnswer, type CriterionId } from "@/domain/review";
import { isoToday } from "@/domain/roster";
import { recordAudit } from "./audit";
import type { User } from "./auth/service";
import { sha256 } from "./canonical";
import { signRecord } from "./esign";
import { PermissionError, requireRole } from "./members";
import { notify } from "./notify";
import { quorumPolicy } from "./settings";
import { recordEarning } from "./pay";
import { applyDecision } from "./submissions";

export const IRB_NAME = process.env.IRB_NAME ?? "Institutional Review Board";

type Motion = "approve" | "require_modifications" | "disapprove" | "table";

function audit(tx: Tx, actor: User | null, action: string, entityType: string, entityId: string, after?: unknown) {
  return recordAudit(tx, { actorUserId: actor?.id ?? null, actorName: actor?.fullName ?? "system", action, entityType, entityId, after });
}

/** Active members in their term, shaped for seat counting. */
export async function seatRoster(tx: Tx): Promise<(SeatMember & { userId: string; profession: string })[]> {
  const today = isoToday();
  const rows = await tx
    .select({ member: members, user: users })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.status, "active"));
  const current = rows.filter((r) => !r.member.termEndsOn || r.member.termEndsOn >= today);
  const links = current.length
    ? await tx.select().from(alternateFor).where(inArray(alternateFor.alternateMemberId, current.map((r) => r.member.id)))
    : [];
  return current.map(({ member, user }) => ({
    id: member.id,
    userId: user.id,
    name: user.fullName,
    membershipType: member.membershipType,
    primaryConcern: member.primaryConcern,
    affiliated: member.affiliated,
    profession: member.profession,
    alternateFor: links.filter((l) => l.alternateMemberId === member.id).map((l) => l.primaryMemberId),
  }));
}

async function memberOf(tx: Tx, actor: User) {
  const [m] = await tx.select().from(members).where(eq(members.userId, actor.id)).limit(1);
  if (!m || m.status !== "active") throw new PermissionError("Only appointed IRB members can do this.");
  return m;
}

/** Submissions whose reviews are done and that are not yet on an open meeting's agenda. */
export async function waitingForMeeting(tx: Tx) {
  const waiting = await tx
    .select({ submission: submissions, study: studies })
    .from(submissions)
    .innerJoin(studies, eq(studies.id, submissions.studyId))
    .where(eq(submissions.status, "awaiting_meeting"));
  if (!waiting.length) return [];
  const onAgenda = await tx
    .select({ submissionId: meetingItems.submissionId })
    .from(meetingItems)
    .innerJoin(meetings, eq(meetings.id, meetingItems.meetingId))
    .where(and(inArray(meetingItems.submissionId, waiting.map((w) => w.submission.id)), inArray(meetings.status, ["scheduled", "in_progress"]), ne(meetingItems.status, "tabled")));
  const taken = new Set(onAgenda.map((o) => o.submissionId));
  return waiting.filter((w) => !taken.has(w.submission.id));
}

/**
 * Finds the earliest time a valid quorum is free and books a meeting for everything waiting.
 * Members with a declared conflict on any agenda study are left out of the quorum calculation,
 * so quorum holds even after they step out.
 */
export async function autoSchedule(tx: Tx, actor: User | null, opts: { earliest?: Date; durationMinutes?: number; videoLink?: string } = {}) {
  const agenda = await waitingForMeeting(tx);
  if (!agenda.length) return { ok: false as const, reason: "Nothing is waiting for a meeting." };
  const roster = await seatRoster(tx);
  const conflicts = await tx
    .select({ memberId: conflictDeclarations.memberId })
    .from(conflictDeclarations)
    .where(and(inArray(conflictDeclarations.studyId, agenda.map((a) => a.study.id)), eq(conflictDeclarations.hasConflict, true)));
  const earliest = opts.earliest ?? new Date();
  const windows = await tx.select().from(availability).where(gte(availability.endsAt, earliest));
  const duration = opts.durationMinutes ?? Math.max(20, 15 * agenda.length);
  const slot = findEarliestSlot(
    roster,
    windows.map((w) => ({ memberId: w.memberId, start: w.startsAt.toISOString(), end: w.endsAt.toISOString() })),
    earliest.toISOString(),
    duration,
    conflicts.map((c) => c.memberId),
    await quorumPolicy(tx),
  );
  if (!slot) return { ok: false as const, reason: "No time found when a valid quorum is available. Ask members to add availability." };
  const meeting = await createMeeting(tx, actor, {
    start: new Date(slot.start),
    end: new Date(slot.end),
    videoLink: opts.videoLink ?? "",
    submissionIds: agenda.map((a) => a.submission.id),
  });
  // Call in only the members the slot needs (primaries first, then their alternates), so the pool
  // can be much larger than the board that convenes.
  await notify(tx, roster.filter((m) => slot.memberIds.includes(m.id)).map((m) => m.userId), {
    subject: `You are called to a board meeting on ${slot.start.slice(0, 16).replace("T", " ")} UTC`,
    body: `${agenda.length} item(s) on the agenda. Review the materials before joining; you count toward quorum only if you have.`,
    link: `/meetings/${meeting.id}`,
    dedupeKey: `meeting-invite:${meeting.id}`,
  });
  return { ok: true as const, meeting, invited: slot.memberIds };
}

export async function createMeeting(
  tx: Tx,
  actor: User | null,
  input: { start: Date; end: Date; videoLink: string; submissionIds: string[] },
) {
  if (actor) requireRole(actor, "chair", "administrator");
  if (!(input.end > input.start)) throw new Error("The meeting must end after it starts.");
  // The IRB chair presides; if the person scheduling is not the chair, default to whoever holds the chair role.
  const chairUserId = actor?.roles.includes("chair")
    ? actor.id
    : (await tx.select({ id: users.id }).from(users).where(sql`'chair' = any(${users.roles})`).limit(1))[0]?.id;
  const chairMember = chairUserId
    ? (await tx.select().from(members).where(eq(members.userId, chairUserId)).limit(1))[0]
    : undefined;
  const [meeting] = await tx
    .insert(meetings)
    .values({ scheduledStart: input.start, scheduledEnd: input.end, videoLink: input.videoLink, chairMemberId: chairMember?.id ?? null })
    .returning();
  if (input.submissionIds.length) {
    await tx.insert(meetingItems).values(input.submissionIds.map((submissionId, i) => ({ meetingId: meeting.id, submissionId, position: i + 1 })));
  }
  await audit(tx, actor, "meeting.scheduled", "meeting", meeting.id, {
    start: input.start.toISOString(),
    end: input.end.toISOString(),
    items: input.submissionIds,
  });
  return meeting;
}

async function loadMeeting(tx: Tx, meetingId: string) {
  const [m] = await tx.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!m) throw new Error("Meeting not found.");
  return m;
}

async function requirePresiding(tx: Tx, actor: User, meetingId: string) {
  const meeting = await loadMeeting(tx, meetingId);
  const m = await memberOf(tx, actor);
  if (!actor.roles.includes("chair") && meeting.chairMemberId !== m.id) {
    throw new PermissionError("Only the chair presiding over this meeting can do this.");
  }
  return { meeting, member: m };
}

export async function startMeeting(tx: Tx, actor: User, meetingId: string) {
  const { meeting, member } = await requirePresiding(tx, actor, meetingId);
  if (meeting.status !== "scheduled") throw new Error("This meeting has already started or ended.");
  await tx.update(meetings).set({ status: "in_progress", startedAt: new Date(), chairMemberId: member.id }).where(eq(meetings.id, meetingId));
  await audit(tx, actor, "meeting.started", "meeting", meetingId);
}

/**
 * A member joins (in person, video or phone). They count toward quorum only if they confirm they
 * have received the materials (FDA IRB FAQ 14). An alternate fills the seat of an absent primary
 * they are listed for.
 */
export async function joinMeeting(
  tx: Tx,
  actor: User,
  meetingId: string,
  mode: "in_person" | "video" | "phone",
  hasMaterials: boolean,
) {
  const meeting = await loadMeeting(tx, meetingId);
  if (meeting.status !== "in_progress") throw new Error("This meeting is not in session.");
  const m = await memberOf(tx, actor);
  const present = await currentPresence(tx, meetingId);
  if (present.some((p) => p.memberId === m.id)) return;
  let replacing: string | null = null;
  if (m.membershipType === "alternate") {
    const roster = await seatRoster(tx);
    const me = roster.find((r) => r.id === m.id);
    const presentIds = new Set(present.map((p) => p.memberId));
    const filled = new Set(present.map((p) => p.replacingMemberId).filter(Boolean));
    replacing = (me?.alternateFor ?? []).find((pid) => !presentIds.has(pid) && !filled.has(pid)) ?? null;
  }
  await tx.insert(meetingAttendance).values({ meetingId, memberId: m.id, mode, hasMaterials, replacingMemberId: replacing });
  await audit(tx, actor, "meeting.joined", "meeting", meetingId, { memberId: m.id, mode, hasMaterials, replacingMemberId: replacing });
}

export async function leaveMeeting(tx: Tx, actor: User, meetingId: string) {
  const m = await memberOf(tx, actor);
  await tx
    .update(meetingAttendance)
    .set({ leftAt: new Date() })
    .where(and(eq(meetingAttendance.meetingId, meetingId), eq(meetingAttendance.memberId, m.id), isNull(meetingAttendance.leftAt)));
  await audit(tx, actor, "meeting.left", "meeting", meetingId, { memberId: m.id });
}

/** Who is in the room right now and counts (joined, not left, has materials). */
export async function currentPresence(tx: Tx, meetingId: string): Promise<Presence[]> {
  const rows = await tx
    .select()
    .from(meetingAttendance)
    .where(and(eq(meetingAttendance.meetingId, meetingId), isNull(meetingAttendance.leftAt)));
  return rows.filter((r) => r.hasMaterials).map((r) => ({ memberId: r.memberId, replacingMemberId: r.replacingMemberId }));
}

async function loadItem(tx: Tx, itemId: string) {
  const [row] = await tx
    .select({ item: meetingItems, submission: submissions, study: studies })
    .from(meetingItems)
    .innerJoin(submissions, eq(submissions.id, meetingItems.submissionId))
    .innerJoin(studies, eq(studies.id, submissions.studyId))
    .where(eq(meetingItems.id, itemId))
    .limit(1);
  if (!row) throw new Error("Agenda item not found.");
  return row;
}

/** Members who must step out for this item: their own recusal, or a conflict declared for the study. */
export async function recusedFor(tx: Tx, itemId: string, studyId: string): Promise<string[]> {
  const own = await tx.select({ memberId: itemRecusals.memberId }).from(itemRecusals).where(eq(itemRecusals.itemId, itemId));
  const declared = await tx
    .select({ memberId: conflictDeclarations.memberId })
    .from(conflictDeclarations)
    .where(and(eq(conflictDeclarations.studyId, studyId), eq(conflictDeclarations.hasConflict, true)));
  return [...new Set([...own, ...declared].map((r) => r.memberId))];
}

export async function itemSeats(tx: Tx, itemId: string) {
  const { item, study } = await loadItem(tx, itemId);
  const roster = await seatRoster(tx);
  const present = await currentPresence(tx, item.meetingId);
  return countSeats(roster, present, await recusedFor(tx, itemId, study.id), await quorumPolicy(tx));
}

/** A member declares a conflict during the meeting and steps out for this item (21 CFR 56.107(e)). */
export async function recuse(tx: Tx, actor: User, itemId: string, reason: string) {
  const m = await memberOf(tx, actor);
  if (!reason.trim()) throw new Error("Give a brief reason.");
  const { item, study } = await loadItem(tx, itemId);
  await tx.insert(itemRecusals).values({ itemId, memberId: m.id, reason: reason.trim() }).onConflictDoNothing();
  await tx
    .insert(conflictDeclarations)
    .values({ memberId: m.id, studyId: study.id, hasConflict: true, details: reason.trim() })
    .onConflictDoUpdate({ target: [conflictDeclarations.memberId, conflictDeclarations.studyId], set: { hasConflict: true, details: reason.trim(), declaredAt: new Date() } });
  await tx.delete(votes).where(and(eq(votes.itemId, itemId), eq(votes.memberId, m.id)));
  await audit(tx, actor, "meeting.recused", "meeting", item.meetingId, { itemId, memberId: m.id, reason: reason.trim() });
}

export interface MotionInput {
  motion: Motion;
  answers: Partial<Record<CriterionId, CriterionAnswer>>;
  explanation?: string;
  controvertedIssues?: string;
  approvalMonths?: number;
  childrenCategory?: string;
}

export function motionProblems(input: MotionInput, involvesChildren: boolean): string[] {
  if (input.motion === "table") return input.explanation?.trim() ? [] : ["Say why the item is being deferred."];
  const problems = validateDecision({
    path: "full_board",
    decision: input.motion,
    answers: input.answers,
    explanation: input.explanation,
    approvalMonths: input.approvalMonths,
  });
  if (input.motion === "approve" && involvesChildren && !input.childrenCategory) {
    problems.push("Record which Subpart D category (21 CFR 50.51 to 50.54) the research meets.");
  }
  return problems;
}

/** The chair puts a motion to a vote. Requires quorum for this item at that moment. */
export async function openVote(tx: Tx, actor: User, itemId: string, input: MotionInput) {
  const { item, submission } = await loadItem(tx, itemId);
  const { meeting } = await requirePresiding(tx, actor, item.meetingId);
  if (meeting.status !== "in_progress") throw new Error("The meeting is not in session.");
  if (item.status !== "pending") throw new Error("This item is not open for a new motion.");
  const problems = motionProblems(input, submission.involvesChildren);
  if (problems.length) return { ok: false as const, problems };
  const seats = await itemSeats(tx, itemId);
  if (!seats.quorum) return { ok: false as const, problems: seats.problems };
  await tx.delete(votes).where(eq(votes.itemId, itemId));
  await tx
    .update(meetingItems)
    .set({
      status: "voting",
      motion: input.motion,
      answers: input.answers,
      explanation: input.explanation ?? null,
      controvertedIssues: input.controvertedIssues ?? null,
      approvalMonths: input.approvalMonths ?? null,
      childrenCategory: input.childrenCategory ?? null,
    })
    .where(eq(meetingItems.id, itemId));
  await audit(tx, actor, "meeting.vote_opened", "meeting", item.meetingId, { itemId, ...input });
  return { ok: true as const };
}

/** A member votes. Only members present, eligible and not recused can vote; email votes do not exist here. */
export async function castVote(tx: Tx, actor: User, itemId: string, vote: VoteValue) {
  const m = await memberOf(tx, actor);
  const { item } = await loadItem(tx, itemId);
  if (item.status !== "voting") throw new Error("Voting is not open on this item.");
  const seats = await itemSeats(tx, itemId);
  if (!seats.votingMemberIds.includes(m.id)) {
    throw new Error("You can vote only while present at the meeting, with the materials, and without a conflict on this item.");
  }
  await tx
    .insert(votes)
    .values({ itemId, memberId: m.id, vote })
    .onConflictDoUpdate({ target: [votes.itemId, votes.memberId], set: { vote, castAt: new Date() } });
  await audit(tx, actor, "meeting.vote_cast", "meeting", item.meetingId, { itemId, memberId: m.id, vote });
}

/** The chair closes the vote. The result is computed against who is present now. */
export async function closeVote(tx: Tx, actor: User, itemId: string) {
  const { item, submission, study } = await loadItem(tx, itemId);
  await requirePresiding(tx, actor, item.meetingId);
  if (item.status !== "voting" || !item.motion) throw new Error("Voting is not open on this item.");
  const seats = await itemSeats(tx, itemId);
  if (!seats.quorum) {
    await tx.update(meetingItems).set({ status: "pending" }).where(eq(meetingItems.id, itemId));
    await tx.delete(votes).where(eq(votes.itemId, itemId));
    await audit(tx, actor, "meeting.vote_void_no_quorum", "meeting", item.meetingId, { itemId, problems: seats.problems });
    return { ok: false as const, problems: ["Quorum was lost, so this vote does not count.", ...seats.problems] };
  }
  const cast = await tx.select().from(votes).where(eq(votes.itemId, itemId));
  const t = tally(seats.votingMemberIds, cast);
  const result = { motion: item.motion, for: t.for, against: t.against, abstain: t.abstain, present: t.present, passed: t.passed };
  await audit(tx, actor, "meeting.vote_closed", "meeting", item.meetingId, { itemId, ...result });

  if (!t.passed) {
    await tx
      .update(meetingItems)
      .set({ status: "pending", motionHistory: [...(item.motionHistory as unknown[]), result] })
      .where(eq(meetingItems.id, itemId));
    return { ok: true as const, ...result };
  }
  await tx
    .update(meetingItems)
    .set({
      status: item.motion === "table" ? "tabled" : "decided",
      votesFor: t.for,
      votesAgainst: t.against,
      votesAbstain: t.abstain,
      votingPresent: t.present,
      passed: true,
      decidedAt: new Date(),
    })
    .where(eq(meetingItems.id, itemId));
  if (item.motion !== "table") {
    const meeting = await loadMeeting(tx, item.meetingId);
    await applyDecision(tx, actor, submission, study, {
      decision: item.motion,
      explanation: item.explanation,
      approvalMonths: item.approvalMonths,
      reviewType: `Full board, convened meeting of ${meeting.startedAt?.toISOString().slice(0, 10)} (vote: ${t.for} for, ${t.against} against, ${t.abstain} abstaining)`,
      decidedBy: `the convened IRB. The meeting minutes record the deliberations.`,
    });
  }
  return { ok: true as const, ...result };
}

/**
 * Ends the meeting: closes attendance, generates the minutes from the record, has the chair sign
 * them, and records attendance pay. Undecided items stay waiting for the next meeting.
 */
export async function adjourn(tx: Tx, actor: User, meetingId: string, password: string) {
  const { meeting } = await requirePresiding(tx, actor, meetingId);
  if (meeting.status !== "in_progress") throw new Error("The meeting is not in session.");
  const voting = await tx.select().from(meetingItems).where(and(eq(meetingItems.meetingId, meetingId), eq(meetingItems.status, "voting")));
  if (voting.length) throw new Error("Close the open vote before adjourning.");
  const endedAt = new Date();
  const minutes = await buildMinutes(tx, meetingId, endedAt);
  const signed = await signRecord(tx, {
    signerUserId: actor.id,
    password,
    meaning: "authorship",
    entityType: "meeting_minutes",
    entityId: meetingId,
    record: { meetingId, minutes },
  });
  if (!signed.ok) return { ok: false as const, problems: ["Password did not match; the meeting is still in session."] };
  await tx
    .update(meetingAttendance)
    .set({ leftAt: endedAt })
    .where(and(eq(meetingAttendance.meetingId, meetingId), isNull(meetingAttendance.leftAt)));
  await tx
    .update(meetings)
    .set({ status: "adjourned", endedAt, minutes, minutesHash: sha256(minutes), minutesSignatureId: signed.signature.id })
    .where(eq(meetings.id, meetingId));
  // Undecided items return to the queue for the next meeting.
  await tx.update(meetingItems).set({ status: "tabled" }).where(and(eq(meetingItems.meetingId, meetingId), eq(meetingItems.status, "pending")));
  const attendees = await tx.select().from(meetingAttendance).where(and(eq(meetingAttendance.meetingId, meetingId), eq(meetingAttendance.hasMaterials, true)));
  for (const memberId of new Set(attendees.map((a) => a.memberId))) {
    await recordEarning(tx, memberId, "meeting_attendance", meetingId);
  }
  await audit(tx, actor, "meeting.adjourned", "meeting", meetingId, { minutesHash: sha256(minutes), signatureId: signed.signature.id });
  return { ok: true as const, minutes };
}

async function buildMinutes(tx: Tx, meetingId: string, endedAt: Date) {
  const meeting = await loadMeeting(tx, meetingId);
  const roster = await seatRoster(tx);
  const name = (id: string | null | undefined) => roster.find((r) => r.id === id)?.name ?? "unknown";
  const attendance = await tx.select().from(meetingAttendance).where(eq(meetingAttendance.meetingId, meetingId)).orderBy(asc(meetingAttendance.joinedAt));
  const attended = new Set(attendance.map((a) => a.memberId));
  const replaced = new Set(attendance.map((a) => a.replacingMemberId).filter(Boolean));
  const items = await tx
    .select({ item: meetingItems, submission: submissions, study: studies })
    .from(meetingItems)
    .innerJoin(submissions, eq(submissions.id, meetingItems.submissionId))
    .innerJoin(studies, eq(studies.id, submissions.studyId))
    .where(eq(meetingItems.meetingId, meetingId))
    .orderBy(asc(meetingItems.position));
  const minutesItems: MinutesItem[] = [];
  for (const { item, submission, study } of items) {
    const recusals = await tx.select().from(itemRecusals).where(eq(itemRecusals.itemId, item.id));
    const declared = await tx
      .select()
      .from(conflictDeclarations)
      .where(and(eq(conflictDeclarations.studyId, study.id), eq(conflictDeclarations.hasConflict, true)));
    const allRecusals = [
      ...recusals.map((r) => ({ id: r.memberId, reason: r.reason })),
      ...declared.filter((d) => attended.has(d.memberId) && !recusals.some((r) => r.memberId === d.memberId)).map((d) => ({ id: d.memberId, reason: d.details })),
    ];
    const history = item.motionHistory as { motion: Motion; for: number; against: number; abstain: number; present: number }[];
    minutesItems.push({
      irbNumber: study.irbNumber,
      title: study.title,
      kind: submission.kind,
      motion: item.passed ? item.motion! : "table",
      votes: item.passed
        ? { for: item.votesFor ?? 0, against: item.votesAgainst ?? 0, abstain: item.votesAbstain ?? 0, present: item.votingPresent ?? 0 }
        : { for: 0, against: 0, abstain: 0, present: 0 },
      passed: !!item.passed,
      recusals: allRecusals.map((r) => ({ name: name(r.id), reason: r.reason })),
      answers: item.answers as Partial<Record<CriterionId, CriterionAnswer>>,
      explanation: item.passed ? item.explanation : "No motion carried; returned to the queue for the next meeting.",
      controvertedIssues: item.controvertedIssues,
      approvalMonths: item.approvalMonths,
      involvesChildren: submission.involvesChildren,
      childrenCategory: item.childrenCategory,
      failedMotions: history,
    });
  }
  return generateMinutes({
    irbName: IRB_NAME,
    meetingId,
    startedAt: (meeting.startedAt ?? meeting.scheduledStart).toISOString(),
    endedAt: endedAt.toISOString(),
    chairName: name(meeting.chairMemberId),
    attendees: attendance.map((a) => {
      const m = roster.find((r) => r.id === a.memberId);
      return {
        name: m?.name ?? "unknown",
        primaryConcern: m?.primaryConcern ?? "scientific",
        affiliated: m?.affiliated ?? true,
        profession: m?.profession ?? "",
        mode: a.mode,
        replacingName: a.replacingMemberId ? name(a.replacingMemberId) : null,
        joinedAt: a.joinedAt.toISOString(),
        leftAt: a.leftAt && a.leftAt < endedAt ? a.leftAt.toISOString() : null,
      };
    }),
    absentMembers: roster
      .filter((r) => r.membershipType === "primary" && !attended.has(r.id))
      .map((r) => (replaced.has(r.id) ? `${r.name} (seat filled by an alternate)` : r.name)),
    guests: [],
    items: minutesItems,
  });
}

export async function meetingView(tx: Tx, meetingId: string) {
  const meeting = await loadMeeting(tx, meetingId);
  const items = await tx
    .select({ item: meetingItems, submission: submissions, study: studies })
    .from(meetingItems)
    .innerJoin(submissions, eq(submissions.id, meetingItems.submissionId))
    .innerJoin(studies, eq(studies.id, submissions.studyId))
    .where(eq(meetingItems.meetingId, meetingId))
    .orderBy(asc(meetingItems.position));
  const roster = await seatRoster(tx);
  const attendance = await tx.select().from(meetingAttendance).where(eq(meetingAttendance.meetingId, meetingId));
  const present = await currentPresence(tx, meetingId);
  const policy = await quorumPolicy(tx);
  const general = countSeats(roster, present, [], policy);
  const perItem = await Promise.all(
    items.map(async (i) => ({
      itemId: i.item.id,
      seats: await itemSeats(tx, i.item.id),
      votes: await tx.select().from(votes).where(eq(votes.itemId, i.item.id)),
    })),
  );
  return { meeting, items, roster, attendance, general, perItem, policy };
}

export async function listMeetings(tx: Tx) {
  return tx.select().from(meetings).orderBy(asc(meetings.scheduledStart));
}
