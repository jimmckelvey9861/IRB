import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { members, studies, submissions } from "@/db/schema";
import { APPROVAL_CRITERIA, type CriterionAnswer, type CriterionId } from "@/domain/review";
import { TEST_DATABASE_URL, freshDb, makeUser } from "@/test/db";
import { verifyAuditChain } from "./audit";
import type { User } from "./auth/service";
import {
  completeReview,
  createStudyDraft,
  declareConflict,
  myAssignments,
  saveConsentResolutions,
  submissionDetail,
  submitForReview,
  type NewStudy,
} from "./submissions";

const run = TEST_DATABASE_URL ? describe : describe.skip;
const PW = "test password 123";
const allMet = Object.fromEntries(APPROVAL_CRITERIA.map((c) => [c.id, "met"])) as Record<CriterionId, CriterionAnswer>;

const CONSENT = `This is a research study. The purpose of this study is to test blood markers. Risks include bruising.
You may not benefit. Alternatives: you may choose not to take part. Records may be inspected by the FDA.
If you have questions, contact the study team. Taking part is voluntary and you may withdraw at any time.
A description of this clinical trial will be available on http://www.ClinicalTrials.gov.`;

function study(over: Partial<NewStudy> = {}): NewStudy {
  return {
    title: "Blood marker study",
    sponsor: "Acme Pharma",
    expertise: ["hematology"],
    summary: "A minimal-risk study collecting small blood samples from adults.",
    protocolText: "",
    consentText: CONSENT,
    minimalRisk: true,
    expeditedCategory: 2,
    applicableClinicalTrial: true,
    involvesChildren: false,
    involvesVulnerable: false,
    ...over,
  };
}

run("submission to decision (database)", () => {
  let db: DB;
  let close: () => Promise<void>;
  let pi: User;
  const reviewers: Record<string, User> = {};

  beforeAll(async () => {
    ({ db, close } = await freshDb());
    pi = await makeUser(db, "Pat Investigator", ["investigator"]);
    const specs = [
      { n: "Exp One", concern: "scientific", exp: true, expertise: ["hematology"] },
      { n: "Exp Two", concern: "scientific", exp: true, expertise: [] },
      { n: "Sci Three", concern: "scientific", exp: false, expertise: ["oncology"] },
      { n: "Lay Four", concern: "nonscientific", exp: false, expertise: [] },
      { n: "Lay Five", concern: "nonscientific", exp: false, expertise: [] },
    ] as const;
    for (const s of specs) {
      const u = await makeUser(db, s.n, ["member"]);
      reviewers[s.n] = u;
      await db.insert(members).values({
        userId: u.id,
        status: "active",
        membershipType: "primary",
        primaryConcern: s.concern,
        affiliated: s.n !== "Lay Five",
        profession: s.n,
        expertise: [...s.expertise],
        experiencedReviewer: s.exp,
        trainingCompletedOn: "2026-01-01",
      });
    }
  });
  afterAll(async () => close?.());

  it("blocks an incomplete consent form until each gap is resolved [REQ-50.25]", async () => {
    const { submission } = await db.transaction((tx) => createStudyDraft(tx, pi, study({ title: "Gap study", consentText: CONSENT.replace("Taking part is voluntary and you may withdraw at any time.", "") })));
    const first = await db.transaction((tx) => submitForReview(tx, pi, submission.id));
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.missing.join(" ")).toMatch(/50\.25\(a\)\(8\)/);
    await db.transaction((tx) =>
      saveConsentResolutions(tx, pi, submission.id, [
        { elementId: "voluntary", location: "Section 7" },
        ...["unforeseeable-risks", "investigator-termination", "additional-costs", "withdrawal-consequences", "new-findings", "number-of-subjects"].map((id) => ({ elementId: id, notApplicableBecause: "Minimal-risk blood draw" })),
      ]),
    );
    const second = await db.transaction((tx) => submitForReview(tx, pi, submission.id));
    expect(second.ok).toBe(true);
  });

  it("runs an expedited review end to end, honoring conflicts [REQ-56.110, REQ-56.107(e), REQ-56.109(e)]", async () => {
    const { submission, study: s } = await db.transaction((tx) => createStudyDraft(tx, pi, study()));
    const naAll = ["unforeseeable-risks", "investigator-termination", "additional-costs", "withdrawal-consequences", "new-findings", "number-of-subjects"].map((id) => ({ elementId: id, notApplicableBecause: "Not applicable to a single blood draw" }));
    await db.transaction((tx) => saveConsentResolutions(tx, pi, submission.id, naAll));
    const sent = await db.transaction((tx) => submitForReview(tx, pi, submission.id));
    expect(sent.ok && sent.path).toBe("expedited");

    // The hematology expert is picked first, but has a conflict.
    let mine = (await myAssignments(db, reviewers["Exp One"])).filter((a) => a.study.id === s.id);
    expect(mine).toHaveLength(1);
    const a1 = mine[0].assignment.id;
    const early = completeReview(db, reviewers["Exp One"], a1, { answers: allMet, notes: "", decision: "approve", approvalMonths: 12, confirmsExpeditedEligibility: true, password: PW });
    await expect(early).rejects.toThrow(/conflict/);
    await db.transaction((tx) => declareConflict(tx, reviewers["Exp One"], a1, true, "I consult for the sponsor"));

    // The system reassigns to the other experienced reviewer at once.
    mine = (await myAssignments(db, reviewers["Exp Two"])).filter((a) => a.study.id === s.id);
    expect(mine).toHaveLength(1);
    const a2 = mine[0].assignment.id;
    await db.transaction((tx) => declareConflict(tx, reviewers["Exp Two"], a2, false, ""));

    const notAllowed = await db.transaction((tx) => completeReview(tx, reviewers["Exp Two"], a2, { answers: allMet, notes: "", decision: "disapprove", explanation: "x", confirmsExpeditedEligibility: true, password: PW }));
    expect(notAllowed.ok).toBe(false);

    const done = await db.transaction((tx) => completeReview(tx, reviewers["Exp Two"], a2, { answers: allMet, notes: "Fine.", decision: "approve", approvalMonths: 12, confirmsExpeditedEligibility: true, password: PW }));
    expect(done.ok).toBe(true);

    const [after] = await db.select().from(submissions).where(eq(submissions.id, submission.id));
    expect(after.status).toBe("approved");
    const [st] = await db.select().from(studies).where(eq(studies.id, s.id));
    expect(st.approvalExpiresOn).toBeTruthy();
    const detail = await submissionDetail(db, submission.id);
    expect(detail.letters).toHaveLength(1);
    expect(detail.letters[0].body).toMatch(/approved this research/);
    await expect(db.execute(sql`update letters set body = 'changed'`)).rejects.toThrow();
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });

  it("sends greater-than-minimal-risk studies to the full board after two reviews [REQ-56.108(c)]", async () => {
    const { submission, study: s } = await db.transaction((tx) =>
      createStudyDraft(tx, pi, study({ title: "Drug study", minimalRisk: false, expeditedCategory: null, expertise: ["oncology"], consentText: CONSENT + " If you are injured, treatment will be provided at no cost." })),
    );
    const naAll = ["unforeseeable-risks", "investigator-termination", "additional-costs", "withdrawal-consequences", "new-findings", "number-of-subjects"].map((id) => ({ elementId: id, location: "Section 12" }));
    await db.transaction((tx) => saveConsentResolutions(tx, pi, submission.id, naAll));
    const sent = await db.transaction((tx) => submitForReview(tx, pi, submission.id));
    expect(sent.ok && sent.path).toBe("full_board");
    const sci = (await myAssignments(db, reviewers["Sci Three"])).find((a) => a.study.id === s.id)!;
    expect(sci.assignment.role).toBe("primary_reviewer");
    const lay = [...(await myAssignments(db, reviewers["Lay Four"])), ...(await myAssignments(db, reviewers["Lay Five"]))].find((a) => a.study.id === s.id)!;
    expect(lay.assignment.role).toBe("secondary_reviewer");
    const layUser = lay.assignment.memberId === (await memberIdOf(db, reviewers["Lay Four"])) ? reviewers["Lay Four"] : reviewers["Lay Five"];

    for (const [u, a] of [[reviewers["Sci Three"], sci.assignment.id], [layUser, lay.assignment.id]] as const) {
      await db.transaction((tx) => declareConflict(tx, u, a, false, ""));
      const r = await db.transaction((tx) => completeReview(tx, u, a, { answers: allMet, notes: "ok", password: PW }));
      expect(r.ok).toBe(true);
    }
    const [after] = await db.select().from(submissions).where(eq(submissions.id, submission.id));
    expect(after.status).toBe("awaiting_meeting");
  });
});

async function memberIdOf(db: DB, u: User) {
  const [m] = await db.select().from(members).where(eq(members.userId, u.id));
  return m.id;
}
