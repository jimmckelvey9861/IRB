import { describe, expect, it } from "vitest";
import { evaluateComposition, type RosterMember } from "./roster";

const TODAY = "2026-11-15";

function m(id: string, over: Partial<RosterMember> = {}): RosterMember {
  return {
    id,
    name: `Member ${id}`,
    status: "active",
    membershipType: "primary",
    primaryConcern: "scientific",
    affiliated: true,
    profession: "physician",
    trainingCompletedOn: "2026-01-01",
    ...over,
  };
}

/** A valid five-member board. */
function validBoard(): RosterMember[] {
  return [
    m("a", { profession: "physician" }),
    m("b", { profession: "pharmacist" }),
    m("c", { profession: "nurse" }),
    m("d", { primaryConcern: "nonscientific", profession: "attorney" }),
    m("e", { primaryConcern: "nonscientific", affiliated: false, profession: "teacher" }),
  ];
}

const codes = (r: ReturnType<typeof evaluateComposition>) => r.issues.map((i) => i.code);

describe("board composition [REQ-56.107]", () => {
  it("accepts a valid five-member board", () => {
    const r = evaluateComposition(validBoard(), TODAY);
    expect(r.canOperate).toBe(true);
    expect(r.issues.filter((i) => i.severity === "blocking")).toEqual([]);
  });

  it("blocks with fewer than five appointed primary members [56.107(a)]", () => {
    const r = evaluateComposition(validBoard().slice(1), TODAY);
    expect(r.canOperate).toBe(false);
    expect(codes(r)).toContain("too-few-members");
  });

  it("does not count members pending appointment, inactive, or past term", () => {
    const board = validBoard();
    board[0].status = "pending_appointment";
    expect(codes(evaluateComposition(board, TODAY))).toContain("too-few-members");
    const board2 = validBoard();
    board2[0].termEndsOn = "2026-11-14";
    expect(codes(evaluateComposition(board2, TODAY))).toContain("too-few-members");
  });

  it("blocks without a nonscientist [56.107(c)]", () => {
    const board = validBoard().map((x) => ({ ...x, primaryConcern: "scientific" as const }));
    expect(codes(evaluateComposition(board, TODAY))).toContain("no-nonscientist");
  });

  it("blocks without a scientist [56.107(c)]", () => {
    const board = validBoard().map((x) => ({ ...x, primaryConcern: "nonscientific" as const }));
    expect(codes(evaluateComposition(board, TODAY))).toContain("no-scientist");
  });

  it("blocks without an unaffiliated member [56.107(d)]", () => {
    const board = validBoard().map((x) => ({ ...x, affiliated: true }));
    expect(codes(evaluateComposition(board, TODAY))).toContain("no-unaffiliated");
  });

  it("blocks a board of one profession [56.107(b)]", () => {
    const board = validBoard().map((x) => ({ ...x, profession: "Physician" }));
    expect(codes(evaluateComposition(board, TODAY))).toContain("single-profession");
  });

  it("warns when all members are one gender [56.107(b)]", () => {
    const board = validBoard().map((x) => ({ ...x, gender: "female" }));
    const r = evaluateComposition(board, TODAY);
    expect(codes(r)).toContain("single-gender");
    expect(r.canOperate).toBe(true);
  });

  it("warns about missing training [AAHRPP II.1.B]", () => {
    const board = validBoard();
    board[2].trainingCompletedOn = null;
    expect(codes(evaluateComposition(board, TODAY))).toContain("training-missing");
  });
});

describe("alternates [FDA IRB FAQ 15]", () => {
  it("blocks an alternate who is not linked to a primary", () => {
    const board = [...validBoard(), m("x", { membershipType: "alternate", alternateFor: [] })];
    expect(codes(evaluateComposition(board, TODAY))).toContain("alternate-unlinked");
  });

  it("blocks an alternate whose qualifications are not comparable", () => {
    const board = [
      ...validBoard(),
      m("x", { membershipType: "alternate", primaryConcern: "scientific", alternateFor: ["d"] }),
    ];
    expect(codes(evaluateComposition(board, TODAY))).toContain("alternate-not-comparable");
  });

  it("accepts a comparable alternate and clears the single-point warning", () => {
    const board = validBoard();
    board[3].primaryConcern = "scientific"; // now "e" is the only nonscientist
    board[3].profession = "chemist";
    const before = evaluateComposition(board, TODAY);
    expect(codes(before)).toContain("single-point-nonscientific");
    const withAlt = [
      ...board,
      m("x", {
        membershipType: "alternate",
        primaryConcern: "nonscientific",
        affiliated: false,
        profession: "clergy",
        alternateFor: ["e"],
      }),
    ];
    const after = evaluateComposition(withAlt, TODAY);
    expect(codes(after)).not.toContain("single-point-nonscientific");
    expect(codes(after)).not.toContain("alternate-not-comparable");
    expect(after.canOperate).toBe(true);
  });
});
