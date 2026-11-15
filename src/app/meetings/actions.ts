"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import type { VoteValue } from "@/domain/meeting";
import { APPROVAL_CRITERIA, type CriterionAnswer, type CriterionId } from "@/domain/review";
import { requireUser } from "@/lib/auth/session";
import {
  adjourn,
  autoSchedule,
  castVote,
  closeVote,
  joinMeeting,
  leaveMeeting,
  openVote,
  recuse,
  startMeeting,
  type MotionInput,
} from "@/lib/meetings";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const to = (path: string, p: Record<string, string>) => redirect(`${path}?${new URLSearchParams(p).toString()}`);

async function run(path: string, fn: () => Promise<unknown>, ok: string) {
  let result: unknown;
  try {
    result = await fn();
  } catch (e) {
    to(path, { error: msg(e) });
  }
  const r = result as { ok?: boolean; problems?: string[]; reason?: string } | undefined;
  if (r && r.ok === false) to(path, { error: r.problems?.join(" ") ?? r.reason ?? "Not done." });
  revalidatePath(path);
  to(path, { ok });
}

export async function scheduleNow(formData: FormData) {
  const actor = await requireUser();
  const videoLink = String(formData.get("videoLink") ?? "");
  await run("/meetings", () => db.transaction((tx) => autoSchedule(tx, actor, { videoLink })), "Meeting booked at the earliest time a valid quorum is free.");
}

export async function start(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("meetingId"));
  await run(`/meetings/${id}`, () => db.transaction((tx) => startMeeting(tx, actor, id)), "Meeting called to order.");
}

export async function join(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("meetingId"));
  const mode = String(formData.get("mode")) as "in_person" | "video" | "phone";
  const hasMaterials = formData.get("hasMaterials") === "yes";
  await run(`/meetings/${id}`, () => db.transaction((tx) => joinMeeting(tx, actor, id, mode, hasMaterials)), "You are marked present.");
}

export async function leave(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("meetingId"));
  await run(`/meetings/${id}`, () => db.transaction((tx) => leaveMeeting(tx, actor, id)), "You are marked as having left.");
}

export async function stepOut(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("meetingId"));
  const itemId = String(formData.get("itemId"));
  await run(`/meetings/${id}`, () => db.transaction((tx) => recuse(tx, actor, itemId, String(formData.get("reason") ?? ""))), "Recusal recorded.");
}

export async function propose(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("meetingId"));
  const itemId = String(formData.get("itemId"));
  const answers: Partial<Record<CriterionId, CriterionAnswer>> = {};
  for (const c of APPROVAL_CRITERIA) {
    const v = formData.get(`c:${c.id}`);
    if (v === "met" || v === "not_met" || v === "na") answers[c.id] = v;
  }
  const input: MotionInput = {
    motion: String(formData.get("motion")) as MotionInput["motion"],
    answers,
    explanation: String(formData.get("explanation") ?? ""),
    controvertedIssues: String(formData.get("controvertedIssues") ?? ""),
    approvalMonths: Number(formData.get("approvalMonths")) || undefined,
    childrenCategory: String(formData.get("childrenCategory") ?? "") || undefined,
  };
  await run(`/meetings/${id}`, () => db.transaction((tx) => openVote(tx, actor, itemId, input)), "Voting is open.");
}

export async function vote(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("meetingId"));
  const itemId = String(formData.get("itemId"));
  const v = String(formData.get("vote")) as VoteValue;
  await run(`/meetings/${id}`, () => db.transaction((tx) => castVote(tx, actor, itemId, v)), "Your vote is recorded.");
}

export async function close(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("meetingId"));
  const itemId = String(formData.get("itemId"));
  let res: Awaited<ReturnType<typeof closeVote>> | undefined;
  try {
    res = await db.transaction((tx) => closeVote(tx, actor, itemId));
  } catch (e) {
    to(`/meetings/${id}`, { error: msg(e) });
  }
  if (!res!.ok) to(`/meetings/${id}`, { error: res!.problems.join(" ") });
  const r = res as { passed: boolean; for: number; against: number; abstain: number; present: number };
  revalidatePath(`/meetings/${id}`);
  to(`/meetings/${id}`, { ok: `Motion ${r.passed ? "carried" : "failed"}: ${r.for} for, ${r.against} against, ${r.abstain} abstaining, of ${r.present} present.` });
}

export async function end(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("meetingId"));
  await run(`/meetings/${id}`, () => db.transaction((tx) => adjourn(tx, actor, id, String(formData.get("password") ?? ""))), "Meeting adjourned. Minutes generated and signed.");
}
