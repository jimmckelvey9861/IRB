/**
 * Review paths, reviewer selection, the approval-criteria checklist and decision rules.
 * Pure functions; no database access.
 *
 * Sources: 21 CFR 56.107(e), 56.109, 56.110, 56.111; FDA IRB FAQ 20; AAHRPP II.1.D, II.1.E, II.2.F, II.3.
 */

/** FDA/OHRP expedited review categories (63 FR 60364, Nov 9 1998), short labels. */
export const EXPEDITED_CATEGORIES = [
  { id: 1, label: "Drug or device study where no IND/IDE is required (or device used per its clearance)" },
  { id: 2, label: "Blood samples by finger, heel, ear stick or venipuncture within set volume limits" },
  { id: 3, label: "Biological specimens collected by noninvasive means" },
  { id: 4, label: "Data collected through noninvasive procedures routinely used in clinical practice" },
  { id: 5, label: "Materials already collected, or to be collected, for non-research purposes" },
  { id: 6, label: "Voice, video, digital or image recordings made for research" },
  { id: 7, label: "Research on individual or group characteristics or behavior, surveys, interviews" },
  { id: 8, label: "Continuing review: enrollment closed and only long-term follow-up remains, or no subjects enrolled" },
  { id: 9, label: "Continuing review of non-IND research where the board found no more than minimal risk" },
] as const;

export type SubmissionKind = "initial" | "amendment" | "continuing";
export type ReviewPath = "expedited" | "full_board";

export interface PathInput {
  kind: SubmissionKind;
  /** Submitter's view; the reviewer confirms or overrides it. */
  minimalRisk: boolean;
  expeditedCategory?: number | null;
  /** For amendments: the submitter says the change is minor (no added risk, no change to the risk/benefit balance). */
  minorChange?: boolean;
}

/** Proposes a path. Expedited only when the rules allow it; otherwise full board (56.110(b)). */
export function proposePath(input: PathInput): { path: ReviewPath; basis: string } {
  if (input.kind === "amendment" && input.minorChange) {
    return { path: "expedited", basis: "Minor change to previously approved research (21 CFR 56.110(b)(2))" };
  }
  // Categories 8 and 9 cover continuing review of research that is not itself minimal risk.
  if (input.kind === "continuing" && (input.expeditedCategory === 8 || input.expeditedCategory === 9)) {
    return {
      path: "expedited",
      basis: `Continuing review, expedited category ${input.expeditedCategory} (21 CFR 56.110(b)(1))`,
    };
  }
  if (
    input.minimalRisk &&
    input.expeditedCategory &&
    input.expeditedCategory <= 7 &&
    EXPEDITED_CATEGORIES.some((c) => c.id === input.expeditedCategory)
  ) {
    return {
      path: "expedited",
      basis: `Minimal risk, expedited category ${input.expeditedCategory} (21 CFR 56.110(b)(1))`,
    };
  }
  return { path: "full_board", basis: "Not eligible for expedited review (21 CFR 56.108(c))" };
}

export interface CandidateMember {
  id: string;
  name: string;
  status: "pending_appointment" | "active" | "inactive";
  membershipType: "primary" | "alternate";
  primaryConcern: "scientific" | "nonscientific";
  expertise: string[];
  experiencedReviewer: boolean;
  trainingCompletedOn?: string | null;
  termEndsOn?: string | null;
  /** Open review assignments, used to spread work. */
  openAssignments: number;
}

export interface SelectionInput {
  path: ReviewPath;
  studyExpertise: string[];
  /** Members who declared a conflict for this study (56.107(e)). */
  conflictedMemberIds: string[];
  /** Members who have not yet answered the conflict question for this study. */
  undeclaredMemberIds?: string[];
  /** Members who were already asked and declined or did not respond. */
  excludeMemberIds?: string[];
  today: string;
}

export interface Selection {
  reviewers: { memberId: string; role: "primary_reviewer" | "secondary_reviewer"; reason: string }[];
  /** Why no assignment could be made, if so. */
  shortfall?: string;
  /** True when no eligible member has the study's expertise: the IRB should bring in a non-voting consultant (AAHRPP II.1.E). */
  consultantNeeded: boolean;
}

function eligible(m: CandidateMember, input: SelectionInput): boolean {
  return (
    m.status === "active" &&
    (!m.termEndsOn || m.termEndsOn >= input.today) &&
    !!m.trainingCompletedOn &&
    !input.conflictedMemberIds.includes(m.id) &&
    !(input.excludeMemberIds ?? []).includes(m.id)
  );
}

function matchScore(m: CandidateMember, wanted: string[]): number {
  const have = new Set(m.expertise.map((e) => e.toLowerCase()));
  return wanted.filter((w) => have.has(w.toLowerCase())).length;
}

function rank(pool: CandidateMember[], wanted: string[]): CandidateMember[] {
  return [...pool].sort(
    (a, b) =>
      matchScore(b, wanted) - matchScore(a, wanted) ||
      a.openAssignments - b.openAssignments ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Picks reviewers.
 * - Expedited: one reviewer, who must be the chair's designated experienced reviewer (56.110(b)).
 * - Full board: a scientific primary reviewer with matching expertise where possible, and a
 *   nonscientific secondary reviewer who reads the consent form from a participant's point of view.
 */
export function selectReviewers(members: CandidateMember[], input: SelectionInput): Selection {
  const pool = members.filter((m) => eligible(m, input));
  const wanted = input.studyExpertise;
  const consultantNeeded = wanted.length > 0 && !pool.some((m) => matchScore(m, wanted) > 0);

  if (input.path === "expedited") {
    const experienced = rank(pool.filter((m) => m.experiencedReviewer), wanted);
    if (!experienced.length) {
      return { reviewers: [], consultantNeeded, shortfall: "No unconflicted, trained, designated experienced reviewer is available." };
    }
    const pick = experienced[0];
    return {
      reviewers: [{ memberId: pick.id, role: "primary_reviewer", reason: reason(pick, wanted, "designated experienced reviewer") }],
      consultantNeeded,
    };
  }

  const scientists = rank(pool.filter((m) => m.primaryConcern === "scientific"), wanted);
  const nonscientists = rank(pool.filter((m) => m.primaryConcern === "nonscientific"), []);
  const reviewers: Selection["reviewers"] = [];
  if (scientists[0]) {
    reviewers.push({ memberId: scientists[0].id, role: "primary_reviewer", reason: reason(scientists[0], wanted, "scientific reviewer") });
  }
  if (nonscientists[0]) {
    reviewers.push({ memberId: nonscientists[0].id, role: "secondary_reviewer", reason: "nonscientific reviewer for the consent form" });
  }
  const shortfall =
    reviewers.length < 2
      ? `Missing an available ${!scientists[0] ? "scientific" : "nonscientific"} reviewer.`
      : undefined;
  return { reviewers, consultantNeeded, shortfall };
}

function reason(m: CandidateMember, wanted: string[], base: string): string {
  const s = matchScore(m, wanted);
  return s > 0 ? `${base}; expertise match (${s} of ${wanted.length})` : `${base}; fewest open reviews`;
}

/** The approval criteria of 21 CFR 56.111. */
export const APPROVAL_CRITERIA = [
  { id: "risks-minimized", cfr: "56.111(a)(1)", text: "Risks to subjects are minimized by sound research design and, where appropriate, by procedures already performed for diagnosis or treatment.", naAllowed: false },
  { id: "risks-reasonable", cfr: "56.111(a)(2)", text: "Risks are reasonable in relation to anticipated benefits, if any, and the importance of the knowledge expected.", naAllowed: false },
  { id: "equitable-selection", cfr: "56.111(a)(3)", text: "Selection of subjects is equitable, with attention to vulnerable populations.", naAllowed: false },
  { id: "consent-sought", cfr: "56.111(a)(4)", text: "Informed consent will be sought from each subject or legally authorized representative as required by Part 50.", naAllowed: false },
  { id: "consent-documented", cfr: "56.111(a)(5)", text: "Informed consent will be appropriately documented as required by 50.27.", naAllowed: false },
  { id: "data-monitoring", cfr: "56.111(a)(6)", text: "Where appropriate, the research plan provides adequate monitoring of data to ensure subject safety.", naAllowed: true },
  { id: "privacy", cfr: "56.111(a)(7)", text: "Where appropriate, there are adequate provisions to protect privacy and maintain confidentiality.", naAllowed: true },
  { id: "vulnerable-safeguards", cfr: "56.111(b)", text: "If some subjects are likely to be vulnerable to coercion or undue influence, additional safeguards are included.", naAllowed: true },
  { id: "children", cfr: "56.111(c); 50 Subpart D", text: "If children are involved, the research meets the requirements of Part 50 Subpart D.", naAllowed: true },
] as const;

export type CriterionId = (typeof APPROVAL_CRITERIA)[number]["id"];
export type CriterionAnswer = "met" | "not_met" | "na";

export type Decision = "approve" | "require_modifications" | "disapprove" | "refer_to_full_board";

export interface DecisionInput {
  path: ReviewPath;
  decision: Decision;
  answers: Partial<Record<CriterionId, CriterionAnswer>>;
  /** Required changes (require_modifications) or reasons (disapprove). */
  explanation?: string;
  /** Expedited reviewer confirms the study really qualifies for expedited review. */
  confirmsExpeditedEligibility?: boolean;
  approvalMonths?: number;
}

/** Returns problems with a proposed decision; empty when it may be signed. */
export function validateDecision(input: DecisionInput): string[] {
  const problems: string[] = [];
  const unanswered = APPROVAL_CRITERIA.filter((c) => !input.answers[c.id]);
  const badNa = APPROVAL_CRITERIA.filter((c) => !c.naAllowed && input.answers[c.id] === "na");
  const notMet = APPROVAL_CRITERIA.filter((c) => input.answers[c.id] === "not_met");

  if (input.decision === "refer_to_full_board") {
    if (input.path !== "expedited") problems.push("Only an expedited review can be referred to the full board.");
    return problems;
  }
  if (unanswered.length) problems.push(`Answer every approval criterion (${unanswered.map((c) => c.cfr).join(", ")}).`);
  for (const c of badNa) problems.push(`${c.cfr} always applies; it cannot be marked not applicable.`);

  if (input.path === "expedited") {
    if (input.decision === "disapprove") {
      problems.push("An expedited reviewer may not disapprove research; refer it to the full board instead (21 CFR 56.110(b)).");
    }
    if (!input.confirmsExpeditedEligibility) {
      problems.push("Confirm the study qualifies for expedited review, or refer it to the full board.");
    }
  }
  if (input.decision === "approve") {
    if (notMet.length) problems.push(`Cannot approve while criteria are not met (${notMet.map((c) => c.cfr).join(", ")}).`);
    if (!input.approvalMonths || input.approvalMonths < 1 || input.approvalMonths > 12) {
      problems.push("Set an approval period of 1 to 12 months; FDA requires continuing review at least yearly (21 CFR 56.109(f)).");
    }
  }
  if (input.decision === "require_modifications" && !input.explanation?.trim()) {
    problems.push("List the changes required.");
  }
  if (input.decision === "disapprove" && !input.explanation?.trim()) {
    problems.push("State the reasons for disapproval; the investigator must receive them in writing (21 CFR 56.109(e)).");
  }
  return problems;
}
