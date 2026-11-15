import { describe, expect, it } from "vitest";
import { DEFAULT_RATES_CENTS, onCallHours, payoutPeriodEnd, reviewEarningKind } from "./earnings";
import { assignSeats, countSeats, findEarliestSlot, tally, type SeatMember } from "./meeting";
import { generateMinutes } from "./minutes";
import { APPROVAL_CRITERIA } from "./review";

function s(id: string, over: Partial<SeatMember> = {}): SeatMember {
  return { id, name: id, membershipType: "primary", primaryConcern: "scientific", affiliated: true, ...over };
}

// Seven seats: five scientists, two nonscientists (one unaffiliated); one alternate for each nonscientist.
const roster: SeatMember[] = [
  s("s1"), s("s2"), s("s3"), s("s4"), s("s5"),
  s("n1", { primaryConcern: "nonscientific" }),
  s("n2", { primaryConcern: "nonscientific", affiliated: false }),
  s("alt-n1", { membershipType: "alternate", primaryConcern: "nonscientific", alternateFor: ["n1"] }),
  s("alt-n2", { membershipType: "alternate", primaryConcern: "nonscientific", affiliated: false, alternateFor: ["n2"] }),
];

describe("quorum [REQ-56.108(c), FDA FAQ 14/15/28]", () => {
  it("needs a majority of seats including a nonscientist", () => {
    const four = countSeats(roster, [{ memberId: "s1" }, { memberId: "s2" }, { memberId: "s3" }, { memberId: "n1" }]);
    expect(four.majorityNeeded).toBe(4);
    expect(four.quorum).toBe(true);
    const noLay = countSeats(roster, [{ memberId: "s1" }, { memberId: "s2" }, { memberId: "s3" }, { memberId: "s4" }]);
    expect(noLay.quorum).toBe(false);
    expect(noLay.problems.join(" ")).toMatch(/nonscientist/);
  });

  it("counts an alternate only in place of an absent primary they are listed for", () => {
    const ok = countSeats(roster, [{ memberId: "s1" }, { memberId: "s2" }, { memberId: "s3" }, { memberId: "alt-n1", replacingMemberId: "n1" }]);
    expect(ok.quorum).toBe(true);
    const wrongSeat = countSeats(roster, [{ memberId: "s1" }, { memberId: "s2" }, { memberId: "s3" }, { memberId: "alt-n1", replacingMemberId: "n2" }]);
    expect(wrongSeat.quorum).toBe(false);
    const both = countSeats(roster, [{ memberId: "s1" }, { memberId: "s2" }, { memberId: "n1" }, { memberId: "alt-n1", replacingMemberId: "n1" }]);
    expect(both.votingMemberIds).not.toContain("alt-n1");
    expect(both.quorum).toBe(false);
  });

  it("loses quorum for an item when a recusal drops it below a majority [FAQ 28]", () => {
    const present = [{ memberId: "s1" }, { memberId: "s2" }, { memberId: "s3" }, { memberId: "n1" }];
    expect(countSeats(roster, present).quorum).toBe(true);
    expect(countSeats(roster, present, ["s1"]).quorum).toBe(false);
    expect(countSeats(roster, present, ["n1"]).problems.join(" ")).toMatch(/nonscientist/);
  });
});

describe("ad hoc pool: five seats, a bench of alternates [REQ-56.108(c), FDA FAQ 15]", () => {
  // Chair, physician, pharmacist (scientific); nonscientist; unaffiliated community member.
  const pool: SeatMember[] = [
    s("chair"), s("md"), s("rph"),
    s("lay", { primaryConcern: "nonscientific" }),
    s("comm", { primaryConcern: "nonscientific", affiliated: false }),
    s("md-alt1", { membershipType: "alternate", alternateFor: ["md", "chair"] }),
    s("md-alt2", { membershipType: "alternate", alternateFor: ["md"] }),
    s("rph-alt", { membershipType: "alternate", alternateFor: ["rph"] }),
    s("lay-alt", { membershipType: "alternate", primaryConcern: "nonscientific", alternateFor: ["lay"] }),
    s("comm-alt", { membershipType: "alternate", primaryConcern: "nonscientific", affiliated: false, alternateFor: ["comm"] }),
    // Wrongly linked: a scientist listed for the nonscientist seat.
    s("bad-alt", { membershipType: "alternate", alternateFor: ["lay"] }),
  ];
  const HOUSE = { requireAllSeats: true };

  it("counts quorum against the five seats, not the size of the pool", () => {
    const three = countSeats(pool, [{ memberId: "md-alt1", replacingMemberId: "chair" }, { memberId: "md-alt2", replacingMemberId: "md" }, { memberId: "lay-alt", replacingMemberId: "lay" }]);
    expect(three.totalSeats).toBe(5);
    expect(three.majorityNeeded).toBe(3);
    expect(three.quorum).toBe(true);
  });

  it("never lets an alternate sit in a seat of a different kind", () => {
    const r = countSeats(pool, [{ memberId: "chair" }, { memberId: "md" }, { memberId: "bad-alt", replacingMemberId: "lay" }]);
    expect(r.votingMemberIds).not.toContain("bad-alt");
    expect(r.quorum).toBe(false);
    expect(assignSeats(pool, ["chair", "md", "bad-alt"]).find((p) => p.memberId === "bad-alt")).toBeUndefined();
  });

  it("house policy: all five seats filled and an unaffiliated member present", () => {
    const legal = [{ memberId: "chair" }, { memberId: "md" }, { memberId: "lay" }];
    expect(countSeats(pool, legal).quorum).toBe(true);
    const house = countSeats(pool, legal, [], HOUSE);
    expect(house.quorum).toBe(false);
    expect(house.problems.join(" ")).toMatch(/every seat must be filled/);

    const full = [{ memberId: "chair" }, { memberId: "md" }, { memberId: "rph-alt", replacingMemberId: "rph" }, { memberId: "lay" }, { memberId: "comm-alt", replacingMemberId: "comm" }];
    expect(countSeats(pool, full, [], HOUSE).quorum).toBe(true);
    // A recusal keeps the seat filled, but the legal majority and nonscientist rules still apply to voters.
    expect(countSeats(pool, full, ["md"], HOUSE).quorum).toBe(true);
    expect(countSeats(pool, full, ["comm-alt"], HOUSE).problems.join(" ")).toMatch(/unaffiliated/);
  });

  it("schedules only when the house policy can be met, calling in alternates", () => {
    const win = (memberId: string) => ({ memberId, start: "2026-11-16T15:00:00Z", end: "2026-11-16T16:00:00Z" });
    const free = ["chair", "md", "rph-alt", "lay"].map(win);
    expect(findEarliestSlot(pool, free, "2026-11-16T14:00:00Z", 30, [], HOUSE)).toBeNull();
    const slot = findEarliestSlot(pool, [...free, win("comm-alt")], "2026-11-16T14:00:00Z", 30, [], HOUSE);
    expect(slot?.memberIds.sort()).toEqual(["chair", "comm-alt", "lay", "md", "rph-alt"]);
  });
});

describe("votes [REQ-56.108(c)]", () => {
  const present = ["a", "b", "c", "d", "e"];
  it("passes only with a majority of members present, so abstentions count against", () => {
    expect(tally(present, [{ memberId: "a", vote: "for" }, { memberId: "b", vote: "for" }, { memberId: "c", vote: "for" }]).passed).toBe(true);
    const t = tally(present, [{ memberId: "a", vote: "for" }, { memberId: "b", vote: "for" }, { memberId: "c", vote: "abstain" }, { memberId: "d", vote: "abstain" }, { memberId: "e", vote: "against" }]);
    expect(t.passed).toBe(false);
    expect(t).toMatchObject({ for: 2, against: 1, abstain: 2, present: 5 });
  });
  it("ignores votes from anyone not eligible (absent, recused, or emailed in)", () => {
    const t = tally(present, [{ memberId: "x", vote: "for" }, { memberId: "a", vote: "for" }]);
    expect(t.for).toBe(1);
  });
});

describe("scheduling", () => {
  const w = (memberId: string, start: string, end: string) => ({ memberId, start, end });
  it("finds the earliest time a valid quorum is free, and uses alternates for missing primaries", () => {
    const windows = [
      w("s1", "2026-11-16T14:00:00Z", "2026-11-16T18:00:00Z"),
      w("s2", "2026-11-16T15:00:00Z", "2026-11-16T18:00:00Z"),
      w("s3", "2026-11-16T15:00:00Z", "2026-11-16T16:00:00Z"),
      w("alt-n2", "2026-11-16T15:30:00Z", "2026-11-16T17:00:00Z"),
      w("n1", "2026-11-16T15:00:00Z", "2026-11-16T15:20:00Z"),
    ];
    const slot = findEarliestSlot(roster, windows, "2026-11-16T13:00:00Z", 30);
    expect(slot?.start).toBe("2026-11-16T15:30:00.000Z");
    expect(slot?.memberIds).toContain("alt-n2");
    expect(slot?.seats.hasUnaffiliated).toBe(true);
  });
  it("returns null when no valid quorum is ever free", () => {
    expect(findEarliestSlot(roster, [w("s1", "2026-11-16T14:00:00Z", "2026-11-16T18:00:00Z")], "2026-11-16T13:00:00Z", 30)).toBeNull();
  });
  it("seats primaries before alternates", () => {
    expect(assignSeats(roster, ["n1", "alt-n1"])).toEqual([{ memberId: "n1" }]);
  });
});

describe("member pay [FDA FAQ 8]", () => {
  it("depends only on the work done, never the decision", () => {
    expect(reviewEarningKind({ path: "expedited", role: "primary_reviewer" })).toBe("expedited_review");
    expect(reviewEarningKind({ path: "full_board", role: "secondary_reviewer" })).toBe("full_board_secondary_review");
    // The function signature has no decision input; this guards against someone adding one.
    expect(reviewEarningKind.length).toBe(1);
    expect(Object.values(DEFAULT_RATES_CENTS).every((c) => c > 0)).toBe(true);
  });
  it("pays whole on-call hours and groups pay into weekly payouts", () => {
    expect(onCallHours("2026-11-16T08:00:00Z", "2026-11-16T12:30:00Z")).toBe(4);
    expect(payoutPeriodEnd(new Date("2026-11-18T10:00:00Z"))).toBe("2026-11-22");
    expect(payoutPeriodEnd(new Date("2026-11-22T10:00:00Z"))).toBe("2026-11-22");
  });
});

describe("minutes [REQ-56.115(a)(2), AAHRPP II.5.B]", () => {
  it("records attendance, recusals, votes, basis and controverted issues", () => {
    const text = generateMinutes({
      irbName: "Test IRB",
      meetingId: "M-1",
      startedAt: "2026-11-16T15:30:00Z",
      endedAt: "2026-11-16T16:00:00Z",
      chairName: "Dr. Chair",
      attendees: [
        { name: "Dr. A", primaryConcern: "scientific", affiliated: true, profession: "physician", mode: "video", joinedAt: "2026-11-16T15:29:00Z" },
        { name: "Mr. Alt", primaryConcern: "nonscientific", affiliated: false, profession: "teacher", mode: "phone", replacingName: "Ms. Lay", joinedAt: "2026-11-16T15:30:00Z" },
      ],
      absentMembers: ["Ms. Lay"],
      guests: [],
      items: [
        {
          irbNumber: "IRB-2026-0002",
          title: "Drug X in adults",
          kind: "initial",
          motion: "require_modifications",
          votes: { for: 4, against: 0, abstain: 1, present: 5 },
          passed: true,
          recusals: [{ name: "Dr. B", reason: "consults for sponsor" }],
          answers: Object.fromEntries(APPROVAL_CRITERIA.map((c) => [c.id, "met"])),
          explanation: "Simplify the consent form to an 8th-grade reading level.",
          controvertedIssues: "Whether the placebo arm is justified; resolved by the existing rescue-medication plan.",
          involvesChildren: false,
        },
      ],
    });
    expect(text).toMatch(/Mr\. Alt .*alternate replacing Ms\. Lay.*by telephone/);
    expect(text).toMatch(/Dr\. B declared a conflicting interest/);
    expect(text).toMatch(/4 for, 0 against, 1 abstaining, of 5/);
    expect(text).toMatch(/Changes required and basis: Simplify/);
    expect(text).toMatch(/Controverted issues and their resolution: Whether the placebo/);
  });
});
