/**
 * Convened (full-board) meetings: who counts toward quorum, how votes are tallied, and finding
 * a time when a valid quorum can meet. Pure functions; no database access.
 *
 * Sources: 21 CFR 56.107(e), 56.108(c), 56.115(a)(2); FDA IRB FAQ 14, 15, 16, 28 (Feb 2025);
 * AAHRPP Element II.5.B.
 *
 * Key rules:
 * - Members may attend in person or by video or phone and are counted if they have the materials
 *   (FAQ 14). Emailed opinions never count as votes or toward quorum.
 * - Quorum is a majority of the IRB's members (primary seats), present, including at least one
 *   member whose primary concerns are nonscientific (56.108(c)).
 * - An alternate counts only when the primary they are listed for is absent, and fills that seat (FAQ 15).
 * - A member with a conflict leaves for that item and does not count; if the count drops below a
 *   majority, quorum fails for that item (FAQ 28).
 * - An action passes with a majority of the members present (56.108(c)), so an abstention has the
 *   same effect as a vote against.
 * - An alternate may sit only in a seat of the same kind (scientific or nonscientific) as the primary
 *   they replace, so substitutions never change the board's make-up.
 *
 * House policy (optional, stricter than the regulation): every seat must be filled, and an
 * unaffiliated member must be present, before the board may act.
 */

export interface QuorumPolicy {
  /** Every primary seat filled (by its primary or a listed alternate) and an unaffiliated member present. */
  requireAllSeats: boolean;
}

export const LEGAL_MINIMUM: QuorumPolicy = { requireAllSeats: false };

export interface SeatMember {
  id: string;
  name: string;
  membershipType: "primary" | "alternate";
  primaryConcern: "scientific" | "nonscientific";
  affiliated: boolean;
  /** For alternates: primary member ids they may replace. */
  alternateFor?: string[];
}

export interface Presence {
  memberId: string;
  /** Alternates name the absent primary whose seat they fill. */
  replacingMemberId?: string | null;
}

export interface SeatCount {
  /** Voting seats filled for this item, by member id (the person actually present). */
  votingMemberIds: string[];
  totalSeats: number;
  majorityNeeded: number;
  hasNonscientist: boolean;
  hasUnaffiliated: boolean;
  quorum: boolean;
  problems: string[];
}

export function countSeats(
  roster: SeatMember[],
  present: Presence[],
  recusedMemberIds: string[] = [],
  policy: QuorumPolicy = LEGAL_MINIMUM,
): SeatCount {
  const primaries = roster.filter((m) => m.membershipType === "primary");
  const byId = new Map(roster.map((m) => [m.id, m]));
  const presentIds = new Set(present.map((p) => p.memberId));
  const problems: string[] = [];
  const voting: SeatMember[] = [];
  const filledSeats = new Set<string>();

  for (const p of present) {
    const m = byId.get(p.memberId);
    if (!m || m.membershipType !== "primary") continue;
    filledSeats.add(m.id);
    if (!recusedMemberIds.includes(m.id)) voting.push(m);
  }
  for (const p of present) {
    const m = byId.get(p.memberId);
    if (!m || m.membershipType !== "alternate") continue;
    const seat = p.replacingMemberId;
    if (!seat || !(m.alternateFor ?? []).includes(seat)) {
      problems.push(`${m.name} is present as an alternate but is not filling a seat they are listed for; they do not count.`);
      continue;
    }
    if (presentIds.has(seat)) {
      problems.push(`${m.name} cannot fill ${byId.get(seat)?.name ?? "that"}'s seat while that member is present.`);
      continue;
    }
    if (byId.get(seat)?.primaryConcern !== m.primaryConcern) {
      problems.push(`${m.name} (${m.primaryConcern}) cannot sit in ${byId.get(seat)?.name ?? "that"}'s ${byId.get(seat)?.primaryConcern ?? ""} seat; they do not count.`);
      continue;
    }
    if (filledSeats.has(seat)) {
      problems.push(`Two alternates are trying to fill ${byId.get(seat)?.name ?? "the same"}'s seat.`);
      continue;
    }
    filledSeats.add(seat);
    if (!recusedMemberIds.includes(m.id) && !recusedMemberIds.includes(seat)) voting.push(m);
  }

  const totalSeats = primaries.length;
  const majorityNeeded = Math.floor(totalSeats / 2) + 1;
  const hasNonscientist = voting.some((m) => m.primaryConcern === "nonscientific");
  const hasUnaffiliated = voting.some((m) => !m.affiliated);
  if (voting.length < majorityNeeded) {
    problems.push(`Quorum needs ${majorityNeeded} of ${totalSeats} members present and voting-eligible; ${voting.length} are.`);
  }
  if (!hasNonscientist) problems.push("Quorum needs at least one nonscientist present (21 CFR 56.108(c)).");
  let housePolicyMet = true;
  if (policy.requireAllSeats) {
    const empty = primaries.filter((p) => !filledSeats.has(p.id));
    if (empty.length) {
      housePolicyMet = false;
      problems.push(`House policy: every seat must be filled; empty: ${empty.map((p) => `${p.name}'s seat`).join(", ")}. Call in a listed alternate.`);
    }
    if (!hasUnaffiliated) {
      housePolicyMet = false;
      problems.push("House policy: an unaffiliated member must be present and voting.");
    }
  }
  return {
    votingMemberIds: voting.map((m) => m.id),
    totalSeats,
    majorityNeeded,
    hasNonscientist,
    hasUnaffiliated,
    quorum: voting.length >= majorityNeeded && hasNonscientist && housePolicyMet,
    problems,
  };
}

export type VoteValue = "for" | "against" | "abstain";

export interface Tally {
  for: number;
  against: number;
  abstain: number;
  notVoted: number;
  present: number;
  passed: boolean;
}

/** A motion passes only with a majority of the voting-eligible members present (56.108(c)). */
export function tally(votingMemberIds: string[], votes: { memberId: string; vote: VoteValue }[]): Tally {
  const eligible = new Set(votingMemberIds);
  const counted = votes.filter((v) => eligible.has(v.memberId));
  const t = {
    for: counted.filter((v) => v.vote === "for").length,
    against: counted.filter((v) => v.vote === "against").length,
    abstain: counted.filter((v) => v.vote === "abstain").length,
  };
  const present = eligible.size;
  return { ...t, notVoted: present - counted.length, present, passed: t.for > present / 2 };
}

export interface Window {
  memberId: string;
  /** ISO timestamps. */
  start: string;
  end: string;
}

export interface Slot {
  start: string;
  end: string;
  memberIds: string[];
  seats: SeatCount;
}

/**
 * Finds the earliest time, at or after `earliest`, when enough members are free for `durationMinutes`
 * to hold a valid meeting. Prefers slots that include an unaffiliated member (FAQ 16), and pairs
 * alternates with absent primaries automatically.
 */
export function findEarliestSlot(
  roster: SeatMember[],
  windows: Window[],
  earliest: string,
  durationMinutes: number,
  conflictedMemberIds: string[] = [],
  policy: QuorumPolicy = LEGAL_MINIMUM,
): Slot | null {
  const dur = durationMinutes * 60_000;
  const from = Date.parse(earliest);
  const starts = [...new Set([from, ...windows.map((w) => Date.parse(w.start))])]
    .filter((t) => t >= from)
    .sort((a, b) => a - b);
  let fallback: Slot | null = null;
  for (const t of starts) {
    const free = windows
      .filter((w) => Date.parse(w.start) <= t && Date.parse(w.end) >= t + dur)
      .map((w) => w.memberId)
      .filter((id) => !conflictedMemberIds.includes(id));
    const freeSet = [...new Set(free)];
    const presence = assignSeats(roster, freeSet);
    const seats = countSeats(roster, presence, [], policy);
    if (!seats.quorum) continue;
    const slot = {
      start: new Date(t).toISOString(),
      end: new Date(t + dur).toISOString(),
      memberIds: presence.map((p) => p.memberId),
      seats,
    };
    if (seats.hasUnaffiliated) return slot;
    fallback ??= slot;
  }
  return fallback;
}

/** Given who is free, seats primaries first, then alternates for absent primaries. */
export function assignSeats(roster: SeatMember[], freeIds: string[]): Presence[] {
  const byId = new Map(roster.map((m) => [m.id, m]));
  const presence: Presence[] = [];
  const free = new Set(freeIds);
  for (const id of freeIds) if (byId.get(id)?.membershipType === "primary") presence.push({ memberId: id });
  const taken = new Set(presence.map((p) => p.memberId));
  for (const id of freeIds) {
    const m = byId.get(id);
    if (m?.membershipType !== "alternate") continue;
    const seat = (m.alternateFor ?? []).find(
      (pid) => !free.has(pid) && !taken.has(pid) && byId.get(pid)?.primaryConcern === m.primaryConcern,
    );
    if (seat) {
      presence.push({ memberId: id, replacingMemberId: seat });
      taken.add(seat);
    }
  }
  return presence;
}
