import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { members, notifications, reviewAssignments, studies } from "@/db/schema";
import { renewedExpiry } from "@/domain/oversight";
import { isoToday } from "@/domain/roster";
import { APPROVAL_CRITERIA, type CriterionAnswer, type CriterionId } from "@/domain/review";
import { TEST_DATABASE_URL, freshDb, makeUser } from "@/test/db";
import { verifyAuditChain } from "./audit";
import type { User } from "./auth/service";
import {
  createFollowOnSubmission,
  determineEvent,
  fileEventReport,
  runOversightSweep,
  signRegulatoryReport,
  studyOversight,
} from "./oversight";
import { completeReview, createStudyDraft, declareConflict, saveConsentResolutions, submissionDetail, submitForReview } from "./submissions";

const run = TEST_DATABASE_URL ? describe : describe.skip;
const PW = "test password 123";
const allMet = Object.fromEntries(APPROVAL_CRITERIA.map((c) => [c.id, "met"])) as Record<CriterionId, CriterionAnswer>;
const CONSENT = `This is a research study. The purpose of this study is to test blood markers. Risks include bruising.
You may not benefit. Alternatives: you may choose not to take part. Records may be inspected by the FDA.
If you have questions, contact the study team. Taking part is voluntary and you may withdraw at any time.
A description of this clinical trial will be available on http://www.ClinicalTrials.gov.`;
const NA = ["unforeseeable-risks", "investigator-termination", "additional-costs", "withdrawal-consequences", "new-findings", "number-of-subjects"].map((id) => ({
  elementId: id,
  notApplicableBecause: "Not applicable to a single blood draw",
}));

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

run("continuing review and problem reports (database)", () => {
  let db: DB;
  let close: () => Promise<void>;
  let pi: User;
  let chair: User;
  let member: User;
  let official: User;
  const byMember = new Map<string, User>();
  let studyId: string;

  /** Sends a submission and has its expedited reviewer approve it. */
  async function approveExpedited(submissionId: string) {
    const sent = await db.transaction((tx) => submitForReview(tx, pi, submissionId));
    expect(sent.ok && sent.path).toBe("expedited");
    const [a] = await db
      .select()
      .from(reviewAssignments)
      .where(and(eq(reviewAssignments.submissionId, submissionId), eq(reviewAssignments.status, "assigned")));
    const reviewer = byMember.get(a.memberId)!;
    await db.transaction((tx) => declareConflict(tx, reviewer, a.id, false, ""));
    const done = await db.transaction((tx) =>
      completeReview(tx, reviewer, a.id, { answers: allMet, notes: "", decision: "approve", approvalMonths: 12, confirmsExpeditedEligibility: true, password: PW }),
    );
    expect(done.ok).toBe(true);
  }
  const expiry = async () => (await db.select().from(studies).where(eq(studies.id, studyId)))[0];

  beforeAll(async () => {
    ({ db, close } = await freshDb());
    pi = await makeUser(db, "Pat Investigator", ["investigator"]);
    official = await makeUser(db, "Olive Official", ["official"]);
    chair = await makeUser(db, "Chris Chair", ["chair", "member"]);
    member = await makeUser(db, "Mel Member", ["member"]);
    const others = [await makeUser(db, "Sam Sci", ["member"]), await makeUser(db, "Lee Lay", ["member"]), await makeUser(db, "Uma Unaffiliated", ["member"])];
    for (const [u, concern, exp] of [
      [chair, "scientific", true],
      [member, "scientific", false],
      [others[0], "scientific", false],
      [others[1], "nonscientific", false],
      [others[2], "nonscientific", false],
    ] as const) {
      const [m] = await db
        .insert(members)
        .values({
          userId: u.id,
          status: "active",
          membershipType: "primary",
          primaryConcern: concern,
          affiliated: u !== others[2],
          profession: u.fullName,
          expertise: [],
          experiencedReviewer: exp,
          trainingCompletedOn: "2026-01-01",
        })
        .returning();
      byMember.set(m.id, u);
    }
    const { submission, study } = await db.transaction((tx) =>
      createStudyDraft(tx, pi, {
        title: "Blood marker study",
        sponsor: "Acme Pharma",
        expertise: [],
        summary: "A minimal-risk study collecting small blood samples from adults.",
        protocolText: "",
        consentText: CONSENT,
        minimalRisk: true,
        expeditedCategory: 2,
        applicableClinicalTrial: true,
        involvesChildren: false,
        involvesVulnerable: false,
      }),
    );
    studyId = study.id;
    await db.transaction((tx) => saveConsentResolutions(tx, pi, submission.id, NA));
    await approveExpedited(submission.id);
  });
  afterAll(async () => close?.());

  it("tells reviewers about new work and investigators about decisions", async () => {
    const mine = await db.select().from(notifications).where(eq(notifications.userId, pi.id));
    expect(mine.some((n) => /Approved/.test(n.subject))).toBe(true);
    const reviewerNotices = await db.select().from(notifications).where(eq(notifications.userId, chair.id));
    expect(reviewerNotices.some((n) => /New review/.test(n.subject))).toBe(true);
  });

  it("extends approval from the old expiry on an on-time continuing review [REQ-56.109(f)]", async () => {
    const before = (await expiry()).approvalExpiresOn!;
    await expect(
      db.transaction((tx) => createFollowOnSubmission(tx, pi, studyId, { kind: "continuing", summary: "Enrollment continues as planned with no problems.", minimalRisk: true, expeditedCategory: 2 })),
    ).rejects.toThrow(/progress report/);
    const sub = await db.transaction((tx) =>
      createFollowOnSubmission(tx, pi, studyId, {
        kind: "continuing",
        summary: "Enrollment continues as planned with no problems.",
        minimalRisk: true,
        expeditedCategory: 2,
        progressReport: { enrolledTotal: 40, enrolledSinceLastReview: 40, withdrawn: 1, enrollmentOpen: true, problemsSummary: "" },
      }),
    );
    expect(sub.consentText).toBe(CONSENT);
    await expect(
      db.transaction((tx) => createFollowOnSubmission(tx, pi, studyId, { kind: "continuing", summary: "A second one at the same time, which is not allowed.", minimalRisk: true, progressReport: { enrolledTotal: 1, enrolledSinceLastReview: 1, withdrawn: 0, enrollmentOpen: true } })),
    ).rejects.toThrow(/already an open/);
    await approveExpedited(sub.id);
    expect((await expiry()).approvalExpiresOn).toBe(renewedExpiry(before, isoToday(), 12));
    const letter = (await submissionDetail(db, sub.id)).letters[0];
    expect(letter.body).toMatch(/Continuing review/);
  });

  it("leaves the approval period alone when an amendment is approved [REQ-56.108(a)(4)]", async () => {
    const before = (await expiry()).approvalExpiresOn;
    const sub = await db.transaction((tx) =>
      createFollowOnSubmission(tx, pi, studyId, { kind: "amendment", summary: "Add a second study site with the same procedures.", minimalRisk: true, minorChange: true }),
    );
    await approveExpedited(sub.id);
    expect((await expiry()).approvalExpiresOn).toBe(before);
    expect((await submissionDetail(db, sub.id)).letters[0].body).toMatch(/approval period is unchanged/);
  });

  it("reminds once per milestone and marks lapsed studies [REQ-56.109(f)]", async () => {
    const today = isoToday();
    await db.update(studies).set({ approvalExpiresOn: addDays(today, 30) }).where(eq(studies.id, studyId));
    expect((await db.transaction((tx) => runOversightSweep(tx, today))).reminded).toBe(1);
    expect((await db.transaction((tx) => runOversightSweep(tx, today))).reminded).toBe(0);

    await db.update(studies).set({ approvalExpiresOn: addDays(today, -1) }).where(eq(studies.id, studyId));
    const swept = await db.transaction((tx) => runOversightSweep(tx, today));
    expect(swept.lapsed).toHaveLength(1);
    expect((await expiry()).status).toBe("lapsed");
    const chairNotices = await db.select().from(notifications).where(eq(notifications.userId, chair.id));
    expect(chairNotices.some((n) => /lapsed/.test(n.subject))).toBe(true);

    // Renewing a lapsed study restarts approval from today.
    const sub = await db.transaction((tx) =>
      createFollowOnSubmission(tx, pi, studyId, {
        kind: "continuing",
        summary: "Late renewal; no research activity happened after approval lapsed.",
        minimalRisk: true,
        expeditedCategory: 2,
        progressReport: { enrolledTotal: 40, enrolledSinceLastReview: 0, withdrawn: 0, enrollmentOpen: true, problemsSummary: "" },
      }),
    );
    await approveExpedited(sub.id);
    const s = await expiry();
    expect(s.status).toBe("active");
    expect(s.approvalExpiresOn).toBe(renewedExpiry(addDays(today, -1), today, 12));
  });

  it("routes a problem report to a signed determination and drafted FDA reports [REQ-56.108(b), REQ-56.113]", async () => {
    const event = await db.transaction((tx) =>
      fileEventReport(tx, pi, studyId, { kind: "unanticipated_problem", occurredOn: isoToday(), description: "A participant fainted during the blood draw and was injured." }),
    );
    const chairNotices = await db.select().from(notifications).where(eq(notifications.userId, chair.id));
    expect(chairNotices.some((n) => /reported/.test(n.subject))).toBe(true);

    const d = { isUnanticipatedProblem: true, noncompliance: "none" as const, action: "suspend" as const, rationale: "Unexpected injury; pause until procedures change." };
    const byMember = await db.transaction((tx) => determineEvent(tx, member, event.id, d, PW));
    expect(byMember.ok).toBe(false);
    const badPw = await db.transaction((tx) => determineEvent(tx, chair, event.id, d, "wrong password 1"));
    expect(badPw.ok).toBe(false);

    const done = await db.transaction((tx) => determineEvent(tx, chair, event.id, d, PW));
    expect(done.ok && done.reports.map((r) => r.kind)).toEqual(["unanticipated_problem", "suspension"]);
    expect((await expiry()).status).toBe("suspended");
    await expect(
      db.transaction((tx) => createFollowOnSubmission(tx, pi, studyId, { kind: "continuing", summary: "Trying to renew while suspended, which is blocked.", minimalRisk: true, progressReport: { enrolledTotal: 1, enrolledSinceLastReview: 0, withdrawn: 0, enrollmentOpen: false } })),
    ).rejects.toThrow(/suspended/);

    const staffView = await studyOversight(db, official, studyId);
    expect(staffView.reports).toHaveLength(2);
    expect(staffView.reports[0].body).toMatch(/A participant fainted/);
    expect((await studyOversight(db, pi, studyId)).reports).toHaveLength(0);

    await expect(db.transaction((tx) => signRegulatoryReport(tx, chair, staffView.reports[0].id, PW))).rejects.toThrow();
    const signed = await db.transaction((tx) => signRegulatoryReport(tx, official, staffView.reports[0].id, PW));
    expect(signed.ok).toBe(true);
    expect((await studyOversight(db, official, studyId)).reports.find((r) => r.id === staffView.reports[0].id)!.status).toBe("signed");
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });

  it("keeps investigators out of other investigators' studies", async () => {
    const other = await makeUser(db, "Other Investigator", ["investigator"]);
    await expect(studyOversight(db, other, studyId)).rejects.toThrow(/access/);
    await expect(
      db.transaction((tx) => fileEventReport(tx, other, studyId, { kind: "complaint", occurredOn: isoToday(), description: "Should not be able to file this report here." })),
    ).rejects.toThrow(/access/);
  });
});

