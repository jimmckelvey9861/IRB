import { asc, desc, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { auditEvents } from "@/db/schema";
import { canonicalJson, sha256 } from "./canonical";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

interface HashedFields extends AuditInput {
  seq: number;
  occurredAt: Date;
  prevHash: string;
}

/** The hash covers every field of the entry plus the previous entry's hash, forming a chain. */
export function hashAuditEntry(e: HashedFields): string {
  return sha256(
    canonicalJson({
      seq: e.seq,
      occurredAt: e.occurredAt.toISOString(),
      actorUserId: e.actorUserId ?? null,
      actorName: e.actorName ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      reason: e.reason ?? null,
      prevHash: e.prevHash,
    }),
  );
}

/**
 * Append an audit entry. Call inside the same transaction as the change it records,
 * so the change and its audit entry are saved together or not at all.
 */
export async function recordAudit(tx: Tx, input: AuditInput): Promise<{ seq: number; hash: string }> {
  // Serialize writers so the chain never forks.
  await tx.execute(sql`select pg_advisory_xact_lock(4242001)`);
  const [last] = await tx
    .select({ seq: auditEvents.seq, hash: auditEvents.hash })
    .from(auditEvents)
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  const prevHash = last?.hash ?? GENESIS_HASH;
  const seq = (last?.seq ?? 0) + 1;
  const occurredAt = new Date();
  const before = normalize(input.before);
  const after = normalize(input.after);
  const hash = hashAuditEntry({ ...input, before, after, seq, occurredAt, prevHash });
  await tx.insert(auditEvents).values({
    seq,
    occurredAt,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before,
    after,
    reason: input.reason ?? null,
    prevHash,
    hash,
  });
  return { seq, hash };
}

/** Round-trip through canonical JSON so what we hash is exactly what jsonb stores and returns. */
function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(canonicalJson(value));
}

export interface ChainCheck {
  ok: boolean;
  entries: number;
  firstBadSeq?: number;
  problem?: string;
}

/** Re-computes every hash. Any edit, deletion or reordering of past entries is detected. */
export async function verifyAuditChain(tx: Tx): Promise<ChainCheck> {
  const rows = await tx.select().from(auditEvents).orderBy(asc(auditEvents.seq));
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return { ok: false, entries: rows.length, firstBadSeq: row.seq, problem: `missing entry ${expectedSeq}` };
    }
    if (row.prevHash !== prevHash) {
      return { ok: false, entries: rows.length, firstBadSeq: row.seq, problem: "chain link broken" };
    }
    const recomputed = hashAuditEntry({
      seq: row.seq,
      occurredAt: row.occurredAt,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before,
      after: row.after,
      reason: row.reason,
      prevHash: row.prevHash,
    });
    if (recomputed !== row.hash) {
      return { ok: false, entries: rows.length, firstBadSeq: row.seq, problem: "entry content altered" };
    }
    prevHash = row.hash;
    expectedSeq++;
  }
  return { ok: true, entries: rows.length };
}
