"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { acknowledgePolicy, approvePolicyVersion, confirmPolicyReviewed, installStarterPolicies, saveDraft } from "@/lib/policies";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function go(path: string, key: "ok" | "error", text: string): never {
  redirect(`${path}?${key}=${encodeURIComponent(text)}`);
}

export async function installStarter() {
  const actor = await requireUser();
  let n = 0;
  try {
    n = await db.transaction((tx) => installStarterPolicies(tx, actor));
  } catch (e) {
    go("/policies", "error", msg(e));
  }
  go("/policies", "ok", `${n} starter procedures loaded as drafts. Have them checked, then the official approves each one.`);
}

export async function save(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("policyId"));
  try {
    await db.transaction((tx) => saveDraft(tx, actor, id, String(formData.get("body") ?? ""), String(formData.get("changeSummary") ?? "")));
  } catch (e) {
    go(`/policies/${id}`, "error", msg(e));
  }
  go(`/policies/${id}`, "ok", "Draft saved.");
}

export async function approve(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("policyId"));
  let r;
  try {
    r = await db.transaction((tx) => approvePolicyVersion(tx, actor, String(formData.get("versionId")), String(formData.get("password") ?? "")));
  } catch (e) {
    go(`/policies/${id}`, "error", msg(e));
  }
  if (!r.ok) go(`/policies/${id}`, "error", r.problem);
  go(`/policies/${id}`, "ok", "Approved and in effect. Members have been asked to read it.");
}

export async function reviewed(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("policyId"));
  let r;
  try {
    r = await db.transaction((tx) => confirmPolicyReviewed(tx, actor, String(formData.get("versionId")), String(formData.get("password") ?? "")));
  } catch (e) {
    go(`/policies/${id}`, "error", msg(e));
  }
  if (!r.ok) go(`/policies/${id}`, "error", r.problem);
  go(`/policies/${id}`, "ok", "Yearly review recorded. The next one is due in 12 months.");
}

export async function acknowledge(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("policyId"));
  try {
    await db.transaction((tx) => acknowledgePolicy(tx, actor, String(formData.get("versionId"))));
  } catch (e) {
    go(`/policies/${id}`, "error", msg(e));
  }
  go(`/policies/${id}`, "ok", "Thank you. Your confirmation is recorded.");
}
