import { describe, expect, it } from "vitest";
import { approvalState, determinationProblems, renewedExpiry, requiredReports } from "./oversight";
import { proposePath } from "./review";

describe("continuing review [REQ-56.109(f)]", () => {
  it("tracks days left, reminder days, and lapse", () => {
    expect(approvalState(null, "2026-11-15")).toEqual({ state: "none" });
    expect(approvalState("2026-12-15", "2026-11-15")).toEqual({ state: "current", daysLeft: 30, remindToday: true });
    expect(approvalState("2026-12-16", "2026-11-15")).toMatchObject({ remindToday: false });
    expect(approvalState("2026-11-15", "2026-11-15")).toMatchObject({ state: "current", daysLeft: 0 });
    expect(approvalState("2026-11-14", "2026-11-15")).toEqual({ state: "lapsed", daysOver: 1 });
  });

  it("renews from the old expiry when on time, from today when lapsed", () => {
    expect(renewedExpiry("2026-12-31", "2026-12-01", 12)).toBe("2027-12-31");
    expect(renewedExpiry("2026-10-31", "2026-11-15", 12)).toBe("2027-11-14");
  });

  it("allows expedited continuing review only in categories 8 and 9 [56.110]", () => {
    expect(proposePath({ kind: "continuing", minimalRisk: false, expeditedCategory: 8 }).path).toBe("expedited");
    expect(proposePath({ kind: "continuing", minimalRisk: false, expeditedCategory: 9 }).path).toBe("expedited");
    expect(proposePath({ kind: "continuing", minimalRisk: false, expeditedCategory: 2 }).path).toBe("full_board");
    expect(proposePath({ kind: "continuing", minimalRisk: true, expeditedCategory: 2 }).path).toBe("expedited");
    expect(proposePath({ kind: "continuing", minimalRisk: false }).path).toBe("full_board");
  });
});

describe("problem reports [REQ-56.108(b), REQ-56.113]", () => {
  it("lists every report the determination requires", () => {
    expect(requiredReports({ isUnanticipatedProblem: false, noncompliance: "minor", action: "none", rationale: "x" })).toEqual([]);
    expect(requiredReports({ isUnanticipatedProblem: true, noncompliance: "serious", action: "suspend", rationale: "x" })).toEqual([
      "unanticipated_problem",
      "serious_noncompliance",
      "suspension",
    ]);
  });
  it("requires reasoning and limits suspension to the chair or board", () => {
    expect(determinationProblems({ isUnanticipatedProblem: false, noncompliance: "none", action: "none", rationale: "" }, "chair")).not.toEqual([]);
    expect(determinationProblems({ isUnanticipatedProblem: true, noncompliance: "none", action: "suspend", rationale: "harm" }, "reviewer")).not.toEqual([]);
    expect(determinationProblems({ isUnanticipatedProblem: true, noncompliance: "none", action: "suspend", rationale: "harm" }, "chair")).toEqual([]);
  });
});
