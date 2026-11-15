/**
 * Member pay. Decided 2026-11-15: a flat rate per completed piece of work plus a stipend for
 * on-call availability, paid promptly. No bonus for speed.
 *
 * FDA allows paying members but "Payment to IRB members should not be related to or dependent
 * upon a favorable decision" (FDA IRB FAQ 8). That is enforced by construction: the functions here
 * never receive the decision, so they cannot use it.
 */

export type EarningKind =
  | "expedited_review"
  | "full_board_primary_review"
  | "full_board_secondary_review"
  | "meeting_attendance"
  | "on_call_hour";

export const EARNING_LABELS: Record<EarningKind, string> = {
  expedited_review: "Expedited review",
  full_board_primary_review: "Full-board primary review",
  full_board_secondary_review: "Full-board secondary review",
  meeting_attendance: "Board meeting attended",
  on_call_hour: "On-call hour",
};

/** Starting rates in US cents; the administrator can change them. Changes apply to work done afterwards. */
export const DEFAULT_RATES_CENTS: Record<EarningKind, number> = {
  expedited_review: 15000,
  full_board_primary_review: 25000,
  full_board_secondary_review: 15000,
  meeting_attendance: 20000,
  on_call_hour: 2500,
};

export interface CompletedReview {
  path: "expedited" | "full_board";
  role: "primary_reviewer" | "secondary_reviewer";
}

/** Which rate a completed review earns. Takes only the work done, never the outcome. */
export function reviewEarningKind(work: CompletedReview): EarningKind {
  if (work.path === "expedited") return "expedited_review";
  return work.role === "primary_reviewer" ? "full_board_primary_review" : "full_board_secondary_review";
}

/** Whole on-call hours in a shift, rounded down; partial hours are not paid. */
export function onCallHours(startIso: string, endIso: string): number {
  const ms = Date.parse(endIso) - Date.parse(startIso);
  return ms > 0 ? Math.floor(ms / 3_600_000) : 0;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Payouts run weekly; work is paid in the payout after the week it was done. */
export function payoutPeriodEnd(earnedAt: Date): string {
  const d = new Date(Date.UTC(earnedAt.getUTCFullYear(), earnedAt.getUTCMonth(), earnedAt.getUTCDate()));
  const daysToSunday = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + daysToSunday);
  return d.toISOString().slice(0, 10);
}
