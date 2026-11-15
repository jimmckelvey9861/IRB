import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { alternateFor, availability, earnings, members, meetings, submissions } from "@/db/schema";
import { APPROVAL_CRITERIA, type CriterionAnswer, type CriterionId } from "@/domain/review";
import { TEST_DATABASE_URL, freshDb, makeUser } from "@/test/db";
import { verifyAuditChain } from "./audit";
import type { User } from "./auth/service";
import {
  adjourn,
  autoSchedule,
  castVote,
  closeVote,
  itemSeats,
  joinMeeting,
  leaveMeeting,
  meetingView,
  openVote,
  recuse,
  startMeeting,
} from "./meetings";
import { memberEarnings, recordEndedOnCallWindows, runPayout } from "./pay";
import { completeReview, createStudyDraft, declareConflict, myAssignments, saveConsentResolutions, submitForReview } from "./submissions";

const run = TEST_DATABASE_URL ? describe : describe.skip;
const PW = "test password 123";
const allMet = Object.fromEntries(APPROVAL_CRITERIA.map((c) => [c.id, "met"])) as Record<CriterionId, CriterionAnswer>;
const CONSENT = `This is a research study of an investigational drug. Risks include nausea. You may not benefit.
Alternatives include standard treatment. Records may be inspected by the FDA. If you are injured, treatment is provided at no cost.
If you have questions, contact the study team. Taking part is voluntary; you may withdraw at any time.
A description of this clinical trial will be available on http://www.ClinicalTrials.gov.`;

run("convened meeting and pay (database)", () => {
  let db: DB;
  let close: () => Promise<void>;
  const u: Record<string, User> = {};
  const mid: Record<string, string> = {};
  let admin: User;
  let pi: User;
  let submissionId: string;

  beforeAll(async () => {
    ({ db, close } = await freshDb());
    admin = await makeUser(db, "Admin", ["administrator"]);
    pi = await makeUser(db, "Pi Person", ["investigator"]);
    const specs = [
      ["chair", "scientific", true, "primary", ["member", "chair"]],
      ["sci2", "scientific", true, "primary", ["member"]],
      ["sci3", "scientific", true, "primary", ["member"]],
      ["lay4", "nonscientific", true, "primary", ["member"]],
      ["lay5", "nonscientific", false, "primary", ["member"]],
      ["alt5", "nonscientific", false, "alternate", ["member"]],
    ] as const;
    for (const [n, concern, affiliated, type, roles] of specs) {
      u[n] = await makeUser(db, n, [...roles]);
      const [m] = await db
        .insert(members)
        .values({ userId: u[n].id, status: "active", membershipType: type, primaryConcern: concern, affiliated, profession: n, trainingCompletedOn: "2026-01-01", expertise: n === "sci2" ? ["oncology"] : [] })
        .returning();
      mid[n] = m.id;
    }
    await db.insert(alternateFor).values({ alternateMemberId: mid.alt5, primaryMemberId: mid.lay5 });

    // A greater-than-minimal-risk study goes through reviewer pre-review to the meeting queue.
    const { submission } = await db.transaction((tx) =>
      createStudyDraft(tx, pi, {
        title: "Drug Z in adults", sponsor: "Zeta", expertise: ["oncology"], summary: "Adults take drug Z or placebo for 12 weeks.",
        protocolText: "", consentText: CONSENT, minimalRisk: false, expeditedCategory: null, applicableClinicalTrial: true, involvesChildren: false, involvesVulnerable: false,
      }),
    );
    submissionId = submission.id;
    await db.transaction((tx) =>
      saveConsentResolutions(tx, pi, submission.id, ["unforeseeable-risks", "investigator-termination", "additional-costs", "withdrawal-consequences", "new-findings", "number-of-subjects"].map((id) => ({ elementId: id, location: "Section 9" }))),
    );
    await db.transaction((tx) => submitForReview(tx, pi, submission.id));
    for (const n of Object.keys(u)) {
      for (const a of await myAssignments(db, u[n])) {
        await db.transaction((tx) => declareConflict(tx, u[n], a.assignment.id, false, ""));
        const r = await db.transaction((tx) => completeReview(tx, u[n], a.assignment.id, { answers: allMet, notes: "pre-review", password: PW }));
        expect(r.ok).toBe(true);
      }
    }
    const [s] = await db.select().from(submissions).where(eq(submissions.id, submission.id));
    expect(s.status).toBe("awaiting_meeting");
  });
  afterAll(async () => close?.());

  it("schedules at the earliest time a valid quorum is free", async () => {
    const base = Date.now() + 3_600_000;
    const at = (h: number) => new Date(base + h * 3_600_000);
    // lay5 (the only unaffiliated primary) is busy; alt5 covers. lay4 is the other nonscientist.
    for (const n of ["chair", "sci2", "lay4", "alt5"]) {
      await db.insert(availability).values({ memberId: mid[n], startsAt: at(1), endsAt: at(3), onCall: n === "chair" });
    }
    await db.insert(availability).values({ memberId: mid.sci3, startsAt: at(0), endsAt: at(0.5) });
    const r = await db.transaction((tx) => autoSchedule(tx, u.chair, { earliest: new Date(base) }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meeting.scheduledStart.getTime()).toBe(at(1).getTime());
      expect(r.invited).toContain(mid.alt5);
    }
  });

  it("runs the meeting: quorum, recusal, votes, decision, minutes, pay [REQ-56.108(c), REQ-56.115(a)(2)]", async () => {
    const [meeting] = await db.select().from(meetings);
    await db.transaction((tx) => startMeeting(tx, u.chair, meeting.id));
    const view0 = await meetingView(db, meeting.id);
    const itemId = view0.items[0].item.id;

    // Joining without the materials does not count toward quorum (FAQ 14).
    await db.transaction((tx) => joinMeeting(tx, u.chair, meeting.id, "video", true));
    await db.transaction((tx) => joinMeeting(tx, u.sci2, meeting.id, "video", true));
    await db.transaction((tx) => joinMeeting(tx, u.sci3, meeting.id, "phone", false));
    expect((await itemSeats(db, itemId)).quorum).toBe(false);

    await db.transaction((tx) => joinMeeting(tx, u.lay4, meeting.id, "video", true));
    await db.transaction((tx) => joinMeeting(tx, u.alt5, meeting.id, "phone", true));
    let seats = await itemSeats(db, itemId);
    expect(seats.quorum).toBe(true);
    expect(seats.votingMemberIds).toContain(mid.alt5);

    // A motion that does not meet the approval rules cannot be put to a vote.
    const bad = await db.transaction((tx) => openVote(tx, u.chair, itemId, { motion: "approve", answers: { ...allMet, "risks-reasonable": "not_met" }, approvalMonths: 12 }));
    expect(bad.ok).toBe(false);

    // First motion fails: abstentions count against (majority of those present).
    expect((await db.transaction((tx) => openVote(tx, u.chair, itemId, { motion: "approve", answers: allMet, approvalMonths: 12 }))).ok).toBe(true);
    await db.transaction((tx) => castVote(tx, u.chair, itemId, "for"));
    await db.transaction((tx) => castVote(tx, u.sci2, itemId, "for"));
    await db.transaction((tx) => castVote(tx, u.lay4, itemId, "abstain"));
    await db.transaction((tx) => castVote(tx, u.alt5, itemId, "abstain"));
    await expect(db.transaction((tx) => castVote(tx, u.sci3, itemId, "for"))).rejects.toThrow(/present/);
    const failed = await db.transaction((tx) => closeVote(tx, u.chair, itemId));
    expect(failed.ok && failed.passed).toBe(false);

    // sci2 discovers a conflict and steps out; quorum (3 of 5 needed) still holds with chair, lay4, alt5.
    await db.transaction((tx) => recuse(tx, u.sci2, itemId, "Owns stock in Zeta"));
    seats = await itemSeats(db, itemId);
    expect(seats.votingMemberIds).not.toContain(mid.sci2);
    expect(seats.quorum).toBe(true);

    expect(
      (await db.transaction((tx) =>
        openVote(tx, u.chair, itemId, { motion: "require_modifications", answers: allMet, explanation: "Shorten the consent form.", controvertedIssues: "Placebo use; accepted given rescue therapy." }),
      )).ok,
    ).toBe(true);
    await expect(db.transaction((tx) => castVote(tx, u.sci2, itemId, "for"))).rejects.toThrow(/conflict/);
    for (const n of ["chair", "lay4", "alt5"]) await db.transaction((tx) => castVote(tx, u[n], itemId, "for"));
    const passed = await db.transaction((tx) => closeVote(tx, u.chair, itemId));
    expect(passed.ok && passed.passed).toBe(true);
    const [s] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
    expect(s.status).toBe("modifications_required");

    await db.transaction((tx) => leaveMeeting(tx, u.lay4, meeting.id));
    const wrongPw = await db.transaction((tx) => adjourn(tx, u.chair, meeting.id, "wrong password 1"));
    expect(wrongPw.ok).toBe(false);
    const done = await db.transaction((tx) => adjourn(tx, u.chair, meeting.id, PW));
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.minutes).toMatch(/alt5 .*alternate replacing lay5.*by telephone/);
      expect(done.minutes).toMatch(/sci2 declared a conflicting interest \(Owns stock in Zeta\)/);
      expect(done.minutes).toMatch(/Motion: Approve\. Vote: 2 for, 0 against, 2 abstaining, of 4 .* Motion failed\./);
      expect(done.minutes).toMatch(/3 for, 0 against, 0 abstaining, of 3/);
      expect(done.minutes).toMatch(/Controverted issues and their resolution: Placebo use/);
      expect(done.minutes).toMatch(/Absent: lay5/);
    }

    // Pay: everyone who attended with materials, never anyone who did not.
    const paidAttendance = await db.select().from(earnings).where(eq(earnings.kind, "meeting_attendance"));
    expect(paidAttendance.map((e) => e.memberId).sort()).toEqual([mid.chair, mid.sci2, mid.lay4, mid.alt5].sort());
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });

  it("pays reviews and on-call hours the same whatever the decision, and runs payouts [FDA FAQ 8]", async () => {
    const reviewPay = await db.select().from(earnings).where(sql`${earnings.kind} in ('full_board_primary_review','full_board_secondary_review')`);
    expect(reviewPay.length).toBe(2);
    // End the on-call window and record the stipend.
    await db.update(availability).set({ startsAt: new Date(Date.now() - 3 * 3_600_000), endsAt: new Date(Date.now() - 60_000) }).where(eq(availability.onCall, true));
    expect(await recordEndedOnCallWindows(db)).toBe(1);
    const chairPay = await memberEarnings(db, mid.chair);
    expect(chairPay.rows.find((r) => r.kind === "on_call_hour")?.quantity).toBe(2);
    await expect(db.transaction((tx) => runPayout(tx, u.chair, "2099-12-31"))).rejects.toThrow();
    const payout = await db.transaction((tx) => runPayout(tx, admin, "2099-12-31"));
    expect(payout?.csv.split("\n")[0]).toBe("member_name,member_email,items,amount_usd");
    expect((await memberEarnings(db, mid.chair)).unpaidCents).toBe(0);
  });
});
