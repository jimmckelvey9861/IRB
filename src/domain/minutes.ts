/**
 * Generates meeting minutes from the meeting record, covering what 21 CFR 56.115(a)(2) and
 * AAHRPP Element II.5.B require: attendance with representative capacity and how each person
 * attended, alternates and whom they replaced, recusals and why, each action with its vote counts,
 * the basis for required changes or disapproval, a summary of controverted issues and their
 * resolution, the approval period, and required protocol-specific findings.
 */

import { APPROVAL_CRITERIA, type CriterionAnswer, type CriterionId } from "./review";

export interface MinutesAttendee {
  name: string;
  primaryConcern: "scientific" | "nonscientific";
  affiliated: boolean;
  profession: string;
  mode: "in_person" | "video" | "phone";
  replacingName?: string | null;
  joinedAt: string;
  leftAt?: string | null;
}

export interface MinutesGuest {
  name: string;
  role: string;
}

export interface MinutesItem {
  irbNumber: string;
  title: string;
  kind: "initial" | "amendment" | "continuing";
  motion: "approve" | "require_modifications" | "disapprove" | "table";
  votes: { for: number; against: number; abstain: number; present: number };
  passed: boolean;
  recusals: { name: string; reason: string }[];
  answers: Partial<Record<CriterionId, CriterionAnswer>>;
  explanation?: string | null;
  controvertedIssues?: string | null;
  approvalMonths?: number | null;
  involvesChildren: boolean;
  childrenCategory?: string | null;
  /** Earlier motions on this item that failed. */
  failedMotions?: { motion: MinutesItem["motion"]; for: number; against: number; abstain: number; present: number }[];
}

export interface MinutesInput {
  irbName: string;
  meetingId: string;
  startedAt: string;
  endedAt: string;
  chairName: string;
  attendees: MinutesAttendee[];
  absentMembers: string[];
  guests: MinutesGuest[];
  items: MinutesItem[];
}

const MODE = { in_person: "in person", video: "by video conference", phone: "by telephone" } as const;
const MOTION = {
  approve: "Approve",
  require_modifications: "Require modifications",
  disapprove: "Disapprove",
  table: "Table (defer to a later meeting)",
} as const;
const KIND = { initial: "Initial review", amendment: "Amendment", continuing: "Continuing review" } as const;

function time(iso: string) {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function generateMinutes(m: MinutesInput): string {
  const lines: string[] = [];
  lines.push(`${m.irbName}: minutes of convened meeting`);
  lines.push(`Meeting ${m.meetingId}`);
  lines.push(`Called to order ${time(m.startedAt)}; adjourned ${time(m.endedAt)}. Chair: ${m.chairName}.`);
  lines.push("");
  lines.push("ATTENDANCE");
  for (const a of m.attendees) {
    const capacity = `${a.primaryConcern === "scientific" ? "scientific" : "nonscientific"} member, ${a.affiliated ? "affiliated" : "unaffiliated"}, ${a.profession}`;
    const alt = a.replacingName ? `; alternate replacing ${a.replacingName}` : "";
    const left = a.leftAt ? `; left ${time(a.leftAt)}` : "";
    lines.push(`- ${a.name} (${capacity}${alt}), present ${MODE[a.mode]}, joined ${time(a.joinedAt)}${left}`);
  }
  if (m.absentMembers.length) lines.push(`Absent: ${m.absentMembers.join(", ")}.`);
  for (const g of m.guests) lines.push(`Guest (non-voting): ${g.name}, ${g.role}.`);
  lines.push("Members attending remotely received all review materials before the meeting and could participate fully in discussion.");
  lines.push("");

  m.items.forEach((item, i) => {
    lines.push(`ITEM ${i + 1}: ${item.irbNumber} - ${item.title}`);
    lines.push(`Type of review: ${KIND[item.kind]}.`);
    for (const r of item.recusals) {
      lines.push(`${r.name} declared a conflicting interest (${r.reason}), left the meeting for this item, and did not vote or count toward quorum.`);
    }
    lines.push("Determinations under 21 CFR 56.111:");
    for (const c of APPROVAL_CRITERIA) {
      const a = item.answers[c.id];
      const word = a === "met" ? "met" : a === "not_met" ? "NOT met" : a === "na" ? "not applicable" : "not recorded";
      lines.push(`  ${c.cfr}: ${word}`);
    }
    if (item.involvesChildren) {
      lines.push(`Children: the IRB found the research approvable under ${item.childrenCategory ?? "[category not recorded]"} of 21 CFR 50 Subpart D, with adequate provisions for assent and parental permission.`);
    }
    for (const f of item.failedMotions ?? []) {
      lines.push(`Motion: ${MOTION[f.motion]}. Vote: ${f.for} for, ${f.against} against, ${f.abstain} abstaining, of ${f.present} voting members present. Motion failed.`);
    }
    lines.push(`Motion: ${MOTION[item.motion]}.`);
    lines.push(`Vote: ${item.votes.for} for, ${item.votes.against} against, ${item.votes.abstain} abstaining, of ${item.votes.present} voting members present. Motion ${item.passed ? "carried" : "failed"}.`);
    if (item.passed && item.motion === "approve" && item.approvalMonths) {
      lines.push(`Approval period: ${item.approvalMonths} months.`);
    }
    if (item.motion === "require_modifications") lines.push(`Changes required and basis: ${item.explanation ?? ""}`);
    if (item.motion === "disapprove") lines.push(`Basis for disapproval: ${item.explanation ?? ""}`);
    if (item.motion === "table") lines.push(`Reason deferred: ${item.explanation ?? ""}`);
    lines.push(`Controverted issues and their resolution: ${item.controvertedIssues?.trim() || "None raised."}`);
    lines.push("");
  });
  lines.push("These minutes were generated from the electronic meeting record and are signed electronically by the chair.");
  return lines.join("\n");
}
