import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { Tx } from "@/db";
import { availability, earnings, members, payRates, payouts, users } from "@/db/schema";
import { DEFAULT_RATES_CENTS, onCallHours, payoutPeriodEnd, type EarningKind } from "@/domain/earnings";
import { recordAudit } from "./audit";
import type { User } from "./auth/service";
import { requireRole } from "./members";

/** The rate in force at a moment: the latest set by the administrator, else the default. */
export async function rateFor(tx: Tx, kind: EarningKind, at: Date = new Date()): Promise<number> {
  const [r] = await tx
    .select()
    .from(payRates)
    .where(and(eq(payRates.kind, kind), lte(payRates.effectiveFrom, at)))
    .orderBy(desc(payRates.effectiveFrom))
    .limit(1);
  return r?.amountCents ?? DEFAULT_RATES_CENTS[kind];
}

export async function setRate(tx: Tx, actor: User, kind: EarningKind, amountCents: number) {
  requireRole(actor, "administrator");
  if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error("Enter a valid amount.");
  await tx.insert(payRates).values({ kind, amountCents });
  await recordAudit(tx, { actorUserId: actor.id, actorName: actor.fullName, action: "pay.rate_set", entityType: "pay_rate", entityId: kind, after: { kind, amountCents } });
}

/**
 * Records pay for one piece of work. Idempotent: the same work never pays twice.
 * Deliberately takes no decision or outcome (FDA IRB FAQ 8).
 */
export async function recordEarning(tx: Tx, memberId: string, kind: EarningKind, refId: string, quantity = 1) {
  if (quantity <= 0) return null;
  const now = new Date();
  const rate = await rateFor(tx, kind, now);
  const [row] = await tx
    .insert(earnings)
    .values({ memberId, kind, refId, quantity, amountCents: rate * quantity, earnedAt: now, periodEnd: payoutPeriodEnd(now) })
    .onConflictDoNothing()
    .returning();
  if (row) {
    await recordAudit(tx, {
      actorUserId: null,
      actorName: "system",
      action: "pay.earned",
      entityType: "member",
      entityId: memberId,
      after: { kind, refId, quantity, amountCents: row.amountCents },
    });
  }
  return row ?? null;
}

/** Pays the on-call stipend for on-call windows that have ended. */
export async function recordEndedOnCallWindows(tx: Tx, now: Date = new Date()) {
  const ended = await tx
    .select()
    .from(availability)
    .where(and(eq(availability.onCall, true), eq(availability.stipendRecorded, false), lte(availability.endsAt, now)));
  for (const w of ended) {
    await recordEarning(tx, w.memberId, "on_call_hour", w.id, onCallHours(w.startsAt.toISOString(), w.endsAt.toISOString()));
    await tx.update(availability).set({ stipendRecorded: true }).where(eq(availability.id, w.id));
  }
  return ended.length;
}

export async function memberEarnings(tx: Tx, memberId: string) {
  const rows = await tx.select().from(earnings).where(eq(earnings.memberId, memberId)).orderBy(desc(earnings.earnedAt)).limit(200);
  const unpaid = rows.filter((r) => !r.payoutId).reduce((s, r) => s + r.amountCents, 0);
  const paid = rows.filter((r) => r.payoutId).reduce((s, r) => s + r.amountCents, 0);
  return { rows, unpaidCents: unpaid, paidCents: paid };
}

/**
 * Closes every pay week that has ended, producing a payout with one line per member.
 * Returns CSV for the payroll or payments service.
 */
export async function runPayout(tx: Tx, actor: User, asOf: string) {
  requireRole(actor, "administrator");
  await recordEndedOnCallWindows(tx);
  const due = await tx
    .select({ e: earnings, name: users.fullName, email: users.email })
    .from(earnings)
    .innerJoin(members, eq(members.id, earnings.memberId))
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(isNull(earnings.payoutId), lte(earnings.periodEnd, asOf)))
    .orderBy(asc(users.fullName));
  if (!due.length) return null;
  const total = due.reduce((s, r) => s + r.e.amountCents, 0);
  const [payout] = await tx.insert(payouts).values({ periodEnd: asOf, totalCents: total }).returning();
  await tx
    .update(earnings)
    .set({ payoutId: payout.id })
    .where(and(isNull(earnings.payoutId), lte(earnings.periodEnd, asOf)));
  const byMember = new Map<string, { name: string; email: string; cents: number; items: number }>();
  for (const r of due) {
    const m = byMember.get(r.e.memberId) ?? { name: r.name, email: r.email, cents: 0, items: 0 };
    m.cents += r.e.amountCents;
    m.items += 1;
    byMember.set(r.e.memberId, m);
  }
  const csv = [
    "member_name,member_email,items,amount_usd",
    ...[...byMember.values()].map((m) => `"${m.name.replace(/"/g, '""')}",${m.email},${m.items},${(m.cents / 100).toFixed(2)}`),
  ].join("\n");
  await recordAudit(tx, {
    actorUserId: actor.id,
    actorName: actor.fullName,
    action: "pay.payout_created",
    entityType: "payout",
    entityId: payout.id,
    after: { periodEnd: asOf, totalCents: total, members: byMember.size },
  });
  return { payout, csv };
}

export async function addAvailability(tx: Tx, actor: User, startsAt: Date, endsAt: Date, onCall: boolean) {
  const [m] = await tx.select().from(members).where(eq(members.userId, actor.id)).limit(1);
  if (!m) throw new Error("You are not an IRB member.");
  if (!(endsAt > startsAt)) throw new Error("The end must be after the start.");
  if (endsAt.getTime() - startsAt.getTime() > 24 * 3_600_000) throw new Error("Enter at most 24 hours at a time.");
  const [row] = await tx.insert(availability).values({ memberId: m.id, startsAt, endsAt, onCall }).returning();
  await recordAudit(tx, { actorUserId: actor.id, actorName: actor.fullName, action: "availability.added", entityType: "member", entityId: m.id, after: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), onCall } });
  return row;
}

