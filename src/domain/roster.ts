/**
 * Board composition rules. Pure functions with no database access, so they are easy to test
 * and to show an inspector.
 *
 * Sources: 21 CFR 56.107; FDA IRB FAQ 15 (alternates); AAHRPP Element II.1.A.
 */

export type PrimaryConcern = "scientific" | "nonscientific";

export interface RosterMember {
  id: string;
  name: string;
  status: "pending_appointment" | "active" | "inactive";
  membershipType: "primary" | "alternate";
  primaryConcern: PrimaryConcern;
  affiliated: boolean;
  profession: string;
  gender?: string | null;
  trainingCompletedOn?: string | null;
  termEndsOn?: string | null;
  /** For alternates: ids of primary members this alternate may replace. */
  alternateFor?: string[];
}

export type Severity = "blocking" | "warning";

export interface CompositionIssue {
  code: string;
  severity: Severity;
  message: string;
  rule: string;
  memberId?: string;
}

export interface CompositionReport {
  canOperate: boolean;
  activePrimaryCount: number;
  issues: CompositionIssue[];
}

export const MIN_MEMBERS = 5;

function isCurrent(m: RosterMember, today: string): boolean {
  return m.status === "active" && (!m.termEndsOn || m.termEndsOn >= today);
}

/**
 * Checks whether the board, as currently appointed, may lawfully review research.
 * "blocking" issues mean the IRB must not review until fixed; "warning" issues should be fixed
 * but do not by themselves invalidate the board.
 */
export function evaluateComposition(roster: RosterMember[], today: string = isoToday()): CompositionReport {
  const issues: CompositionIssue[] = [];
  const current = roster.filter((m) => isCurrent(m, today));
  const primaries = current.filter((m) => m.membershipType === "primary");
  const alternates = current.filter((m) => m.membershipType === "alternate");

  if (primaries.length < MIN_MEMBERS) {
    issues.push({
      code: "too-few-members",
      severity: "blocking",
      rule: "21 CFR 56.107(a)",
      message: `The IRB needs at least ${MIN_MEMBERS} appointed primary members; it has ${primaries.length}.`,
    });
  }
  if (!primaries.some((m) => m.primaryConcern === "scientific")) {
    issues.push({
      code: "no-scientist",
      severity: "blocking",
      rule: "21 CFR 56.107(c)",
      message: "At least one member must have primary concerns in scientific areas.",
    });
  }
  if (!primaries.some((m) => m.primaryConcern === "nonscientific")) {
    issues.push({
      code: "no-nonscientist",
      severity: "blocking",
      rule: "21 CFR 56.107(c)",
      message: "At least one member must have primary concerns in nonscientific areas.",
    });
  }
  if (!primaries.some((m) => !m.affiliated)) {
    issues.push({
      code: "no-unaffiliated",
      severity: "blocking",
      rule: "21 CFR 56.107(d)",
      message: "At least one member must not be affiliated with the institution (nor be immediate family of someone who is).",
    });
  }
  const professions = new Set(primaries.map((m) => m.profession.trim().toLowerCase()).filter(Boolean));
  if (primaries.length > 0 && professions.size <= 1) {
    issues.push({
      code: "single-profession",
      severity: "blocking",
      rule: "21 CFR 56.107(b)",
      message: "The IRB may not consist entirely of members of one profession.",
    });
  }
  const genders = new Set(primaries.map((m) => m.gender?.trim().toLowerCase()).filter((g): g is string => !!g));
  if (primaries.length >= MIN_MEMBERS && genders.size === 1 && primaries.every((m) => m.gender)) {
    issues.push({
      code: "single-gender",
      severity: "warning",
      rule: "21 CFR 56.107(b)",
      message: "Every nondiscriminatory effort should be made so the IRB is not entirely one gender.",
    });
  }

  // Robustness: if the only member of a required category is absent, can an alternate cover?
  for (const category of ["nonscientific", "unaffiliated"] as const) {
    const holders = primaries.filter((m) =>
      category === "nonscientific" ? m.primaryConcern === "nonscientific" : !m.affiliated,
    );
    if (holders.length === 1) {
      const sole = holders[0];
      const covered = alternates.some(
        (a) =>
          a.alternateFor?.includes(sole.id) &&
          (category === "nonscientific" ? a.primaryConcern === "nonscientific" : !a.affiliated),
      );
      if (!covered) {
        issues.push({
          code: `single-point-${category}`,
          severity: "warning",
          rule: category === "nonscientific" ? "21 CFR 56.108(c)" : "FDA IRB FAQ 16",
          memberId: sole.id,
          message:
            category === "nonscientific"
              ? `${sole.name} is the only nonscientist and has no matching alternate; no full-board meeting can reach quorum without them.`
              : `${sole.name} is the only unaffiliated member and has no matching alternate; FDA expects unaffiliated members to attend regularly.`,
        });
      }
    }
  }

  for (const alt of roster.filter((m) => m.membershipType === "alternate" && m.status !== "inactive")) {
    issues.push(...checkAlternate(alt, roster));
  }

  for (const m of current) {
    if (!m.trainingCompletedOn) {
      issues.push({
        code: "training-missing",
        severity: "warning",
        rule: "AAHRPP I.1.E, II.1.B",
        memberId: m.id,
        message: `${m.name} has no recorded human-subjects training; they will not be assigned reviews.`,
      });
    }
  }

  return {
    canOperate: !issues.some((i) => i.severity === "blocking"),
    activePrimaryCount: primaries.length,
    issues,
  };
}

/** An alternate must name the primaries they replace and be of comparable qualification (FDA IRB FAQ 15). */
export function checkAlternate(alt: RosterMember, roster: RosterMember[]): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const targets = alt.alternateFor ?? [];
  if (targets.length === 0) {
    issues.push({
      code: "alternate-unlinked",
      severity: "blocking",
      rule: "FDA IRB FAQ 15",
      memberId: alt.id,
      message: `${alt.name} is an alternate but is not linked to any primary member they may replace.`,
    });
    return issues;
  }
  for (const pid of targets) {
    const primary = roster.find((m) => m.id === pid);
    if (!primary || primary.membershipType !== "primary") {
      issues.push({
        code: "alternate-bad-link",
        severity: "blocking",
        rule: "FDA IRB FAQ 15",
        memberId: alt.id,
        message: `${alt.name} is linked to someone who is not a primary member.`,
      });
      continue;
    }
    if (primary.primaryConcern !== alt.primaryConcern) {
      issues.push({
        code: "alternate-not-comparable",
        severity: "blocking",
        rule: "FDA IRB FAQ 15",
        memberId: alt.id,
        message: `${alt.name} (${alt.primaryConcern}) cannot replace ${primary.name} (${primary.primaryConcern}); an alternate's qualifications must be comparable.`,
      });
    }
    if (!primary.affiliated && alt.affiliated) {
      issues.push({
        code: "alternate-affiliation-mismatch",
        severity: "warning",
        rule: "FDA IRB FAQ 15",
        memberId: alt.id,
        message: `${alt.name} is affiliated but may replace unaffiliated member ${primary.name}; that substitution will not count as an unaffiliated member.`,
      });
    }
  }
  return issues;
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
