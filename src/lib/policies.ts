import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import type { Tx } from "@/db";
import { policies, policyAcknowledgments, policyVersions } from "@/db/schema";
import { STARTER_POLICIES } from "@/domain/policy-library";
import { isoToday } from "@/domain/roster";
import { addMonthsIso } from "@/domain/training";
import { recordAudit } from "./audit";
import type { User } from "./auth/service";
import { sha256 } from "./canonical";
import { signRecord } from "./esign";
import { PermissionError, requireRole } from "./members";
import { notify, usersWithRole } from "./notify";

const audit = (tx: Tx, actor: User | null, action: string, entityId: string, after?: unknown) =>
  recordAudit(tx, { actorUserId: actor?.id ?? null, actorName: actor?.fullName ?? "system", action, entityType: "policy", entityId, after });

/** Loads the starter procedures as drafts. Safe to run again: existing codes are skipped. */
export async function installStarterPolicies(tx: Tx, actor: User) {
  requireRole(actor, "administrator");
  const existing = new Set((await tx.select({ code: policies.code }).from(policies)).map((p) => p.code));
  let added = 0;
  for (const sp of STARTER_POLICIES.filter((p) => !existing.has(p.code))) {
    const [p] = await tx.insert(policies).values({ code: sp.code, title: sp.title, sources: sp.sources }).returning();
    await tx.insert(policyVersions).values({
      policyId: p.id,
      version: 1,
      body: sp.body,
      bodyHash: sha256(sp.body),
      changeSummary: "Starter draft",
      draftedById: actor.id,
    });
    await audit(tx, actor, "policy.drafted", p.id, { code: sp.code, version: 1 });
    added++;
  }
  return added;
}

/** Writes or updates the draft of the next version. Approved text never changes. */
export async function saveDraft(tx: Tx, actor: User, policyId: string, body: string, changeSummary: string) {
  requireRole(actor, "administrator", "chair");
  if (body.trim().length < 50) throw new Error("The policy text is too short.");
  const versions = await tx.select().from(policyVersions).where(eq(policyVersions.policyId, policyId));
  if (!versions.length) throw new Error("Policy not found.");
  const draft = versions.find((v) => v.status === "draft");
  if (draft) {
    await tx
      .update(policyVersions)
      .set({ body, bodyHash: sha256(body), changeSummary, draftedById: actor.id })
      .where(eq(policyVersions.id, draft.id));
    await audit(tx, actor, "policy.draft_updated", policyId, { version: draft.version, bodyHash: sha256(body), changeSummary });
    return draft.id;
  }
  const version = Math.max(...versions.map((v) => v.version)) + 1;
  const [v] = await tx
    .insert(policyVersions)
    .values({ policyId, version, body, bodyHash: sha256(body), changeSummary, draftedById: actor.id })
    .returning();
  await audit(tx, actor, "policy.drafted", policyId, { version, bodyHash: v.bodyHash, changeSummary });
  return v.id;
}

/** The organizational official approves a draft by e-signature; it takes effect today. */
export async function approvePolicyVersion(tx: Tx, actor: User, versionId: string, password: string) {
  requireRole(actor, "official");
  const [v] = await tx.select().from(policyVersions).where(eq(policyVersions.id, versionId)).limit(1);
  if (!v) throw new Error("Version not found.");
  if (v.status !== "draft") throw new Error("Only a draft can be approved.");
  const [p] = await tx.select().from(policies).where(eq(policies.id, v.policyId)).limit(1);
  const sig = await signRecord(tx, {
    signerUserId: actor.id,
    password,
    meaning: "approval",
    entityType: "policy_version",
    entityId: versionId,
    record: { code: p.code, title: p.title, version: v.version, bodyHash: v.bodyHash },
  });
  if (!sig.ok) return { ok: false as const, problem: sig.reason === "locked" ? "Your account is locked." : "Password incorrect." };
  const today = isoToday();
  await tx
    .update(policyVersions)
    .set({ status: "superseded" })
    .where(and(eq(policyVersions.policyId, v.policyId), eq(policyVersions.status, "in_effect")));
  await tx
    .update(policyVersions)
    .set({ status: "in_effect", approvedById: actor.id, signatureId: sig.signature.id, effectiveFrom: today, reviewDueOn: addMonthsIso(today, 12) })
    .where(eq(policyVersions.id, versionId));
  await audit(tx, actor, "policy.approved", p.id, { version: v.version, bodyHash: v.bodyHash, signatureId: sig.signature.id });
  const readers = [...new Set([...(await usersWithRole(tx, "member")), ...(await usersWithRole(tx, "chair")), ...(await usersWithRole(tx, "administrator"))])];
  await notify(tx, readers, {
    subject: `${p.code} ${p.title}: version ${v.version} is in effect`,
    body: "Please read it and confirm.",
    link: `/policies/${p.id}`,
    dedupeKey: `policy-ack:${versionId}`,
  });
  return { ok: true as const };
}

/** The yearly review found no changes needed: the official signs and the next review is a year out. */
export async function confirmPolicyReviewed(tx: Tx, actor: User, versionId: string, password: string) {
  requireRole(actor, "official");
  const [v] = await tx.select().from(policyVersions).where(eq(policyVersions.id, versionId)).limit(1);
  if (!v || v.status !== "in_effect") throw new Error("Only the version in effect can be reviewed.");
  const sig = await signRecord(tx, {
    signerUserId: actor.id,
    password,
    meaning: "review",
    entityType: "policy_version",
    entityId: versionId,
    record: { versionId, bodyHash: v.bodyHash, reviewedOn: isoToday() },
  });
  if (!sig.ok) return { ok: false as const, problem: sig.reason === "locked" ? "Your account is locked." : "Password incorrect." };
  const next = addMonthsIso(isoToday(), 12);
  await tx.update(policyVersions).set({ reviewDueOn: next }).where(eq(policyVersions.id, versionId));
  await audit(tx, actor, "policy.reviewed_no_change", v.policyId, { version: v.version, nextReview: next, signatureId: sig.signature.id });
  return { ok: true as const };
}

export async function acknowledgePolicy(tx: Tx, actor: User, versionId: string) {
  const [v] = await tx.select().from(policyVersions).where(eq(policyVersions.id, versionId)).limit(1);
  if (!v || v.status !== "in_effect") throw new Error("Only the version in effect can be acknowledged.");
  const rows = await tx.insert(policyAcknowledgments).values({ versionId, userId: actor.id }).onConflictDoNothing().returning();
  if (rows.length) await audit(tx, actor, "policy.acknowledged", v.policyId, { version: v.version });
}

export async function listPolicies(tx: Tx, userId: string) {
  const ps = await tx.select().from(policies).orderBy(asc(policies.code));
  const vs = ps.length
    ? await tx.select().from(policyVersions).where(inArray(policyVersions.policyId, ps.map((p) => p.id)))
    : [];
  const acks = await tx.select().from(policyAcknowledgments).where(eq(policyAcknowledgments.userId, userId));
  return ps.map((p) => {
    const current = vs.find((v) => v.policyId === p.id && v.status === "in_effect") ?? null;
    const draft = vs.find((v) => v.policyId === p.id && v.status === "draft") ?? null;
    return { policy: p, current, draft, acknowledged: !!current && acks.some((a) => a.versionId === current.id) };
  });
}

export async function policyDetail(tx: Tx, actor: User, policyId: string) {
  const [p] = await tx.select().from(policies).where(eq(policies.id, policyId)).limit(1);
  if (!p) throw new Error("Policy not found.");
  const staff = actor.roles.some((r) => r !== "investigator");
  const versions = await tx.select().from(policyVersions).where(eq(policyVersions.policyId, policyId)).orderBy(desc(policyVersions.version));
  const visible = staff ? versions : versions.filter((v) => v.status === "in_effect");
  if (!visible.length) throw new PermissionError("This policy is not in effect yet.");
  const current = versions.find((v) => v.status === "in_effect");
  const [ack] = current
    ? await tx
        .select()
        .from(policyAcknowledgments)
        .where(and(eq(policyAcknowledgments.versionId, current.id), eq(policyAcknowledgments.userId, actor.id)))
    : [];
  return { policy: p, versions: visible, acknowledged: !!ack };
}

/** Reminds the official 30 days before a policy's yearly review is due, and again when it is overdue. */
export async function policyReviewSweep(tx: Tx, today = isoToday()) {
  const due = await tx
    .select({ v: policyVersions, p: policies })
    .from(policyVersions)
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(and(eq(policyVersions.status, "in_effect"), lte(policyVersions.reviewDueOn, addMonthsIso(today, 1))));
  const officials = await usersWithRole(tx, "official");
  let sent = 0;
  for (const { v, p } of due) {
    const overdue = v.reviewDueOn! < today;
    sent += await notify(tx, officials, {
      subject: `${p.code} ${p.title}: yearly review ${overdue ? "overdue" : `due ${v.reviewDueOn}`}`,
      body: "Confirm it is still accurate, or have a revision drafted.",
      link: `/policies/${p.id}`,
      dedupeKey: `policy-review:${v.id}:${v.reviewDueOn}:${overdue ? "overdue" : "due"}`,
    });
  }
  return sent;
}

