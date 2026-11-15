import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { signatures, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { checkPasswordForUser } from "./auth/service";
import { canonicalJson, sha256 } from "./canonical";

/**
 * Electronic signatures under 21 CFR Part 11.
 *
 * - Each signing re-checks the signer's password, even inside a signed-in session (11.200(a)).
 *   The session itself was opened with password + authenticator code, so every signature rests on
 *   two components.
 * - The stored signature shows printed name, date and time, and meaning (11.50).
 * - The signature stores a hash of the exact record content signed, so it cannot be moved to a
 *   different or altered record (11.70); verifySignature() proves it.
 */

export const SIGNATURE_MEANINGS = {
  appointment: "Appointment of IRB member",
  approval: "Approval",
  review: "Review completed",
  authorship: "Authorship",
  responsibility: "Responsibility",
} as const;
export type SignatureMeaning = keyof typeof SIGNATURE_MEANINGS;

export interface SignInput {
  signerUserId: string;
  password: string;
  meaning: SignatureMeaning;
  entityType: string;
  entityId: string;
  /** The record content being signed. Hashed canonically. */
  record: unknown;
}

export type SignResult =
  | { ok: true; signature: typeof signatures.$inferSelect }
  | { ok: false; reason: "invalid" | "locked" | "disabled" | "no-user" };

export function recordHash(record: unknown): string {
  return sha256(canonicalJson(record));
}

export async function signRecord(tx: Tx, input: SignInput): Promise<SignResult> {
  const [user] = await tx.select().from(users).where(eq(users.id, input.signerUserId)).limit(1);
  if (!user) return { ok: false, reason: "no-user" };
  if (user.disabledAt) return { ok: false, reason: "disabled" };
  const check = await checkPasswordForUser(tx, user, input.password, "esign.failed");
  if (!check.ok) return check;

  const hash = recordHash(input.record);
  const signedAt = new Date();
  const meaning = SIGNATURE_MEANINGS[input.meaning];
  const audit = await recordAudit(tx, {
    actorUserId: user.id,
    actorName: user.fullName,
    action: "esign.signed",
    entityType: input.entityType,
    entityId: input.entityId,
    after: { meaning, recordHash: hash, signedAt: signedAt.toISOString() },
  });
  const [signature] = await tx
    .insert(signatures)
    .values({
      userId: user.id,
      signerName: user.fullName,
      meaning,
      entityType: input.entityType,
      entityId: input.entityId,
      recordHash: hash,
      signedAt,
      auditSeq: audit.seq,
    })
    .returning();
  return { ok: true, signature };
}

/** True when the record content still matches what was signed. */
export function verifySignature(signature: { recordHash: string }, record: unknown): boolean {
  return signature.recordHash === recordHash(record);
}

export async function signaturesFor(tx: Tx, entityType: string, entityId: string) {
  return tx
    .select()
    .from(signatures)
    .where(and(eq(signatures.entityType, entityType), eq(signatures.entityId, entityId)))
    .orderBy(asc(signatures.signedAt));
}

/** Human-readable signature line, for screens and generated PDFs (11.50(b)). */
export function signatureManifestation(sig: { signerName: string; signedAt: Date; meaning: string }): string {
  return `Electronically signed by ${sig.signerName} on ${sig.signedAt.toISOString().replace("T", " ").slice(0, 19)} UTC. Meaning: ${sig.meaning}.`;
}
