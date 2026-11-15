import { describe, expect, it } from "vitest";
import { checkConsentText, unresolvedElements } from "./consent";
import {
  APPROVAL_CRITERIA,
  proposePath,
  selectReviewers,
  validateDecision,
  type CandidateMember,
  type CriterionAnswer,
  type CriterionId,
} from "./review";

const TODAY = "2026-11-15";

function c(id: string, over: Partial<CandidateMember> = {}): CandidateMember {
  return {
    id,
    name: id,
    status: "active",
    membershipType: "primary",
    primaryConcern: "scientific",
    expertise: [],
    experiencedReviewer: false,
    trainingCompletedOn: "2026-01-01",
    openAssignments: 0,
    ...over,
  };
}

const allMet = Object.fromEntries(APPROVAL_CRITERIA.map((x) => [x.id, "met"])) as Record<CriterionId, CriterionAnswer>;

describe("review path [REQ-56.110]", () => {
  it("routes minor amendments and minimal-risk listed categories to expedited review", () => {
    expect(proposePath({ kind: "amendment", minimalRisk: false, minorChange: true }).path).toBe("expedited");
    expect(proposePath({ kind: "initial", minimalRisk: true, expeditedCategory: 2 }).path).toBe("expedited");
  });
  it("sends everything else to the full board", () => {
    expect(proposePath({ kind: "initial", minimalRisk: false, expeditedCategory: 2 }).path).toBe("full_board");
    expect(proposePath({ kind: "initial", minimalRisk: true }).path).toBe("full_board");
    expect(proposePath({ kind: "amendment", minimalRisk: true, minorChange: false }).path).toBe("full_board");
  });
});

describe("reviewer selection [REQ-56.107(e), REQ-AAHRPP-II.1.E]", () => {
  const members = [
    c("onc", { expertise: ["oncology"], openAssignments: 3 }),
    c("card", { expertise: ["cardiology"] }),
    c("lay", { primaryConcern: "nonscientific" }),
    c("exp", { experiencedReviewer: true, expertise: ["oncology"] }),
    c("untrained", { trainingCompletedOn: null, expertise: ["oncology"] }),
  ];

  it("never assigns a conflicted member", () => {
    const s = selectReviewers(members, { path: "full_board", studyExpertise: ["oncology"], conflictedMemberIds: ["onc", "exp"], today: TODAY });
    expect(s.reviewers.map((r) => r.memberId)).not.toContain("onc");
    expect(s.reviewers.map((r) => r.memberId)).not.toContain("exp");
  });

  it("prefers matching expertise, then lighter workload", () => {
    const s = selectReviewers(members, { path: "full_board", studyExpertise: ["oncology"], conflictedMemberIds: [], today: TODAY });
    expect(s.reviewers[0].memberId).toBe("exp");
    expect(s.reviewers[1]).toMatchObject({ memberId: "lay", role: "secondary_reviewer" });
  });

  it("skips untrained members and flags a consultant when nobody has the expertise", () => {
    const s = selectReviewers(members, { path: "full_board", studyExpertise: ["pediatrics"], conflictedMemberIds: [], today: TODAY });
    expect(s.consultantNeeded).toBe(true);
    expect(s.reviewers.map((r) => r.memberId)).not.toContain("untrained");
  });

  it("uses only designated experienced reviewers for expedited review [56.110(b)]", () => {
    const s = selectReviewers(members, { path: "expedited", studyExpertise: [], conflictedMemberIds: [], today: TODAY });
    expect(s.reviewers).toHaveLength(1);
    expect(s.reviewers[0].memberId).toBe("exp");
    const none = selectReviewers(members, { path: "expedited", studyExpertise: [], conflictedMemberIds: ["exp"], today: TODAY });
    expect(none.reviewers).toHaveLength(0);
    expect(none.shortfall).toBeTruthy();
  });
});

describe("decisions [REQ-56.111, REQ-56.109]", () => {
  it("allows a complete expedited approval", () => {
    expect(
      validateDecision({ path: "expedited", decision: "approve", answers: allMet, confirmsExpeditedEligibility: true, approvalMonths: 12 }),
    ).toEqual([]);
  });

  it("forbids an expedited reviewer from disapproving [56.110(b)]", () => {
    const p = validateDecision({ path: "expedited", decision: "disapprove", answers: allMet, explanation: "x", confirmsExpeditedEligibility: true });
    expect(p.join(" ")).toMatch(/may not disapprove/);
  });

  it("requires every criterion, and none unmet, to approve [56.111]", () => {
    const partial = { ...allMet, privacy: undefined } as Partial<Record<CriterionId, CriterionAnswer>>;
    expect(validateDecision({ path: "full_board", decision: "approve", answers: partial, approvalMonths: 12 }).length).toBeGreaterThan(0);
    expect(validateDecision({ path: "full_board", decision: "approve", answers: { ...allMet, "risks-reasonable": "not_met" }, approvalMonths: 12 }).length).toBeGreaterThan(0);
    expect(validateDecision({ path: "full_board", decision: "approve", answers: { ...allMet, "risks-minimized": "na" }, approvalMonths: 12 }).length).toBeGreaterThan(0);
  });

  it("caps approval at 12 months [56.109(f)]", () => {
    expect(validateDecision({ path: "full_board", decision: "approve", answers: allMet, approvalMonths: 13 }).length).toBeGreaterThan(0);
  });

  it("requires written reasons for disapproval and listed changes for modifications", () => {
    expect(validateDecision({ path: "full_board", decision: "disapprove", answers: allMet }).join(" ")).toMatch(/reasons/);
    expect(validateDecision({ path: "full_board", decision: "require_modifications", answers: allMet }).join(" ")).toMatch(/changes/);
  });
});

const GOOD_CONSENT = `
This is a research study. The purpose of this study is to test an investigational drug. The study lasts 12 weeks.
Risks and side effects include headache and nausea. There may be risks that are not known.
You may not benefit from taking part; others may benefit in the future. Alternatives: you can choose other treatments.
Records may be inspected by the Food and Drug Administration (FDA).
If you are injured, medical treatment will be provided; no compensation is offered.
If you have questions or concerns, contact Dr. Smith at 555-0100.
Taking part is voluntary; you may withdraw at any time without penalty.
The study doctor may remove you from the study without your consent. There is no cost to you.
If you decide to leave the study, we will ask you to come for a final safety visit. We will tell you about new information.
About 120 people will take part.
A description of this clinical trial will be available on http://www.ClinicalTrials.gov, as required by U.S. Law.
`;

describe("consent form elements [REQ-50.25]", () => {
  it("finds all elements in a complete form", () => {
    const r = checkConsentText(GOOD_CONSENT, { greaterThanMinimalRisk: true, applicableClinicalTrial: true });
    expect(r.missingRequired).toEqual([]);
    expect(r.missingAdditional).toEqual([]);
  });

  it("flags missing required elements and requires resolution", () => {
    const text = GOOD_CONSENT.replace(/Taking part is voluntary; you may withdraw at any time without penalty\./, "").replace(/If you decide to leave the study,[^.]*\./, "");
    const r = checkConsentText(text, { greaterThanMinimalRisk: true, applicableClinicalTrial: true });
    expect(r.missingRequired.map((e) => e.id)).toContain("voluntary");
    expect(unresolvedElements(r, []).map((e) => e.id)).toContain("voluntary");
    // A required element cannot be waved away as "not applicable"...
    expect(unresolvedElements(r, [{ elementId: "voluntary", notApplicableBecause: "n/a" }]).map((e) => e.id)).toContain("voluntary");
    // ...but pointing to where it is covered resolves it.
    const resolutions = [
      { elementId: "voluntary", location: "Section 9, page 4" },
      { elementId: "withdrawal-consequences", notApplicableBecause: "No safety follow-up needed after withdrawal" },
    ];
    expect(unresolvedElements(r, resolutions)).toEqual([]);
  });

  it("requires the ClinicalTrials.gov statement only for applicable clinical trials [50.25(c)]", () => {
    const text = GOOD_CONSENT.replace(/A description of this clinical trial[^\n]*/, "");
    expect(checkConsentText(text, { greaterThanMinimalRisk: true, applicableClinicalTrial: true }).missingRequired.map((e) => e.id)).toEqual(["clinicaltrials-gov"]);
    expect(checkConsentText(text, { greaterThanMinimalRisk: true, applicableClinicalTrial: false }).missingRequired).toEqual([]);
  });
});
