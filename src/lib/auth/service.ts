import { and, eq, gt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Tx } from "@/db";
import { sessions, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { sha256 } from "@/lib/canonical";
import { verifyPassword } from "./password";
import { generateTotpSecret, verifyTotp } from "./totp";

/** Lock an account after this many consecutive failed attempts (21 CFR 11.300(d)). */
export const MAX_FAILED_ATTEMPTS = 5;
/** Sessions end after this much inactivity. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Sessions end this long after sign-in regardless of activity. */
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

export type CredentialResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "locked" | "disabled" };

/**
 * Checks an email and password. Failed attempts are counted and audited; the account locks
 * after MAX_FAILED_ATTEMPTS and must be unlocked by an administrator.
 */
export async function checkCredentials(tx: Tx, email: string, password: string): Promise<CredentialResult> {
  const [user] = await tx
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  if (!user) {
    // Same work as a real check so response time does not reveal which emails exist.
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    await recordAudit(tx, {
      actorUserId: null,
      actorName: null,
      action: "auth.login_failed",
      entityType: "user",
      after: { email: email.trim().toLowerCase(), reason: "unknown account" },
    });
    return { ok: false, reason: "invalid" };
  }
  if (user.disabledAt) return { ok: false, reason: "disabled" };
  if (user.lockedAt) return { ok: false, reason: "locked" };
  return checkPasswordForUser(tx, user, password, "auth.login_failed");
}

/** Verifies a known user's password, counting failures toward lockout. Used at sign-in and at e-signature. */
export async function checkPasswordForUser(
  tx: Tx,
  user: User,
  password: string,
  failureAction: string,
): Promise<CredentialResult> {
  if (user.lockedAt) return { ok: false, reason: "locked" };
  if (await verifyPassword(password, user.passwordHash)) {
    if (user.failedLogins > 0) await tx.update(users).set({ failedLogins: 0 }).where(eq(users.id, user.id));
    return { ok: true, user };
  }
  const failed = user.failedLogins + 1;
  const lock = failed >= MAX_FAILED_ATTEMPTS;
  await tx
    .update(users)
    .set({ failedLogins: failed, lockedAt: lock ? new Date() : null })
    .where(eq(users.id, user.id));
  await recordAudit(tx, {
    actorUserId: user.id,
    actorName: user.fullName,
    action: failureAction,
    entityType: "user",
    entityId: user.id,
    after: { failedAttempts: failed, locked: lock },
  });
  if (lock) {
    await recordAudit(tx, {
      actorUserId: null,
      actorName: "system",
      action: "auth.account_locked",
      entityType: "user",
      entityId: user.id,
      reason: `${MAX_FAILED_ATTEMPTS} consecutive failed password attempts`,
    });
  }
  return { ok: false, reason: lock ? "locked" : "invalid" };
}

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(tx: Tx, userId: string): Promise<{ token: string; session: Session }> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const [session] = await tx
    .insert(sessions)
    .values({
      id: sha256(token),
      userId,
      mfaVerified: false,
      expiresAt: new Date(now + ABSOLUTE_TIMEOUT_MS),
      lastSeenAt: new Date(now),
    })
    .returning();
  return { token, session };
}

/** Looks up a live session from its raw token, enforcing idle and absolute timeouts. */
export async function getSessionByToken(
  tx: Tx,
  token: string,
): Promise<{ session: Session; user: User } | null> {
  const now = new Date();
  const [row] = await tx
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (now.getTime() - row.session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await tx.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  if (row.user.disabledAt || row.user.lockedAt) return null;
  await tx.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
  return row;
}

export async function endSession(tx: Tx, token: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.id, sha256(token)));
}

/** Starts authenticator enrollment; the secret is held on the session until confirmed. */
export async function beginTotpEnrollment(tx: Tx, session: Session): Promise<string> {
  if (session.pendingTotpSecret) return session.pendingTotpSecret;
  const secret = generateTotpSecret();
  await tx.update(sessions).set({ pendingTotpSecret: secret }).where(eq(sessions.id, session.id));
  return secret;
}

/** Second sign-in step: confirms enrollment or checks the code from an enrolled authenticator. */
export async function completeMfa(tx: Tx, session: Session, user: User, code: string): Promise<boolean> {
  const enrolling = !user.totpSecret;
  const secret = user.totpSecret ?? session.pendingTotpSecret;
  if (!secret) return false;
  if (!verifyTotp(secret, code)) {
    await checkPasswordForUserFailureOnly(tx, user, "auth.mfa_failed");
    return false;
  }
  if (enrolling) {
    await tx.update(users).set({ totpSecret: secret }).where(eq(users.id, user.id));
    await recordAudit(tx, {
      actorUserId: user.id,
      actorName: user.fullName,
      action: "auth.mfa_enrolled",
      entityType: "user",
      entityId: user.id,
    });
  }
  await tx
    .update(sessions)
    .set({ mfaVerified: true, pendingTotpSecret: null })
    .where(eq(sessions.id, session.id));
  await recordAudit(tx, {
    actorUserId: user.id,
    actorName: user.fullName,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
  });
  return true;
}

async function checkPasswordForUserFailureOnly(tx: Tx, user: User, action: string) {
  const failed = user.failedLogins + 1;
  const lock = failed >= MAX_FAILED_ATTEMPTS;
  await tx
    .update(users)
    .set({ failedLogins: failed, lockedAt: lock ? new Date() : null })
    .where(eq(users.id, user.id));
  await recordAudit(tx, {
    actorUserId: user.id,
    actorName: user.fullName,
    action,
    entityType: "user",
    entityId: user.id,
    after: { failedAttempts: failed, locked: lock },
  });
}
