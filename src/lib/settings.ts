import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { settings } from "@/db/schema";
import { LEGAL_MINIMUM, type QuorumPolicy } from "@/domain/meeting";
import { recordAudit } from "./audit";
import type { User } from "./auth/service";
import { signRecord } from "./esign";
import { requireRole } from "./members";

export async function quorumPolicy(tx: Tx): Promise<QuorumPolicy> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, "quorum_policy")).limit(1);
  return { ...LEGAL_MINIMUM, ...((row?.value as Partial<QuorumPolicy>) ?? {}) };
}

/** The official changes the quorum policy by e-signature. The regulatory minimum always applies. */
export async function setQuorumPolicy(tx: Tx, actor: User, policy: QuorumPolicy, password: string) {
  requireRole(actor, "official");
  const before = await quorumPolicy(tx);
  const sig = await signRecord(tx, { signerUserId: actor.id, password, meaning: "approval", entityType: "setting", entityId: "quorum_policy", record: policy });
  if (!sig.ok) return { ok: false as const, problem: sig.reason === "locked" ? "Your account is locked." : "Password incorrect." };
  await tx
    .insert(settings)
    .values({ key: "quorum_policy", value: policy, updatedById: actor.id, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: policy, updatedById: actor.id, updatedAt: new Date() } });
  await recordAudit(tx, { actorUserId: actor.id, actorName: actor.fullName, action: "setting.changed", entityType: "setting", entityId: "quorum_policy", before, after: policy });
  return { ok: true as const };
}
