/**
 * Ongoing oversight after approval: continuing review deadlines and problem reports.
 * Pure functions; no database access.
 *
 * Sources: 21 CFR 56.108(b), 56.109(f), 56.110(b), 56.113; AAHRPP II.2.G, II.2.H.
 */

/** Reminders before approval lapses, in days. */
export const RENEWAL_REMINDER_DAYS = [60, 30, 14, 7, 1] as const;

export type ApprovalState =
  | { state: "none" }
  | { state: "current"; daysLeft: number; remindToday: boolean }
  | { state: "lapsed"; daysOver: number };

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/**
 * Approval is valid through its expiry date. The next day it lapses and all research activity must
 * stop (no enrollment, no interventions), unless the IRB finds it is in subjects' best interests for
 * already-enrolled subjects to continue.
 */
export function approvalState(expiresOn: string | null, today: string): ApprovalState {
  if (!expiresOn) return { state: "none" };
  const daysLeft = daysBetween(today, expiresOn);
  if (daysLeft < 0) return { state: "lapsed", daysOver: -daysLeft };
  return { state: "current", daysLeft, remindToday: (RENEWAL_REMINDER_DAYS as readonly number[]).includes(daysLeft) };
}

/** A continuing review restarts the clock from the old expiry if renewed on time, so no days are lost or gained. */
export function renewedExpiry(currentExpiry: string | null, today: string, months: number): string {
  const base = currentExpiry && currentExpiry >= today ? addDays(currentExpiry, 1) : today;
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type EventKind = "unanticipated_problem" | "adverse_event" | "protocol_deviation" | "noncompliance" | "complaint" | "other";

export const EVENT_LABELS: Record<EventKind, string> = {
  unanticipated_problem: "Possible unanticipated problem involving risks to subjects or others",
  adverse_event: "Serious or unexpected adverse event",
  protocol_deviation: "Protocol deviation",
  noncompliance: "Possible noncompliance with regulations or IRB requirements",
  complaint: "Complaint from a participant or other person",
  other: "Other information that may affect the study",
};

export type BoardAction = "none" | "require_modifications" | "suspend" | "terminate";

export interface Determination {
  isUnanticipatedProblem: boolean;
  noncompliance: "none" | "minor" | "serious" | "continuing";
  action: BoardAction;
  rationale: string;
}

export type RegulatoryReportKind =
  | "unanticipated_problem"
  | "serious_noncompliance"
  | "continuing_noncompliance"
  | "suspension"
  | "termination";

export const REPORT_LABELS: Record<RegulatoryReportKind, string> = {
  unanticipated_problem: "Unanticipated problem involving risks to human subjects or others",
  serious_noncompliance: "Serious noncompliance",
  continuing_noncompliance: "Continuing noncompliance",
  suspension: "Suspension of IRB approval",
  termination: "Termination of IRB approval",
};

/**
 * Which prompt reports a determination requires. Each goes to the investigator, the institution's
 * officials and FDA (21 CFR 56.108(b)(1)-(3), 56.113).
 */
export function requiredReports(d: Determination): RegulatoryReportKind[] {
  const out: RegulatoryReportKind[] = [];
  if (d.isUnanticipatedProblem) out.push("unanticipated_problem");
  if (d.noncompliance === "serious") out.push("serious_noncompliance");
  if (d.noncompliance === "continuing") out.push("continuing_noncompliance");
  if (d.action === "suspend") out.push("suspension");
  if (d.action === "terminate") out.push("termination");
  return out;
}

/**
 * Who may make the determination. A single designated reviewer may decide there is nothing to report
 * or ask for changes, but suspension or termination, like disapproval, needs the convened board,
 * unless the chair acts urgently to protect subjects (which the board must then review).
 */
export function determinationProblems(d: Determination, by: "chair" | "reviewer"): string[] {
  const p: string[] = [];
  if (!d.rationale.trim()) p.push("Explain the reasoning behind the determination.");
  if ((d.action === "suspend" || d.action === "terminate") && by !== "chair") {
    p.push("Only the chair (urgently, subject to board review) or the convened board can suspend or terminate approval.");
  }
  return p;
}
