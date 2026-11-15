import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { alternateFor, members, users } from "@/db/schema";
import { evaluateComposition, type RosterMember } from "@/domain/roster";
import { recordAudit } from "./audit";
import { hashPassword } from "./auth/password";
import type { User } from "./auth/service";
import { signRecord } from "./esign";

export const NewMemberSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.email().trim(),
  temporaryPassword: z.string().min(12),
  membershipType: z.enum(["primary", "alternate"]),
  primaryConcern: z.enum(["scientific", "nonscientific"]),
  affiliated: z.boolean(),
  profession: z.string().trim().min(2),
  degrees: z.string().trim().default(""),
  gender: z.string().trim().optional(),
  expertise: z.array(z.string().trim().min(1)).default([]),
  trainingCompletedOn: z.iso.date().optional(),
  termEndsOn: z.iso.date().optional(),
  alternateFor: z.array(z.uuid()).default([]),
});
export type NewMember = z.infer<typeof NewMemberSchema>;

export class PermissionError extends Error {}

export function requireRole(actor: User, ...roles: User["roles"]) {
  if (!roles.some((r) => actor.roles.includes(r))) {
    throw new PermissionError(`This action needs one of these roles: ${roles.join(", ")}.`);
  }
}

/** Adds a member as "pending appointment". They count toward the board only once the official signs. */
export async function createMember(tx: Tx, actor: User, input: NewMember) {
  requireRole(actor, "administrator");
  const data = NewMemberSchema.parse(input);
  const [user] = await tx
    .insert(users)
    .values({
      email: data.email,
      fullName: data.fullName,
      passwordHash: await hashPassword(data.temporaryPassword),
      roles: ["member"],
    })
    .returning();
  const [member] = await tx
    .insert(members)
    .values({
      userId: user.id,
      membershipType: data.membershipType,
      primaryConcern: data.primaryConcern,
      affiliated: data.affiliated,
      profession: data.profession,
      degrees: data.degrees,
      gender: data.gender || null,
      expertise: data.expertise,
      trainingCompletedOn: data.trainingCompletedOn ?? null,
      termEndsOn: data.termEndsOn ?? null,
    })
    .returning();
  if (data.membershipType === "alternate" && data.alternateFor.length) {
    await tx
      .insert(alternateFor)
      .values(data.alternateFor.map((primaryMemberId) => ({ alternateMemberId: member.id, primaryMemberId })));
  }
  await recordAudit(tx, {
    actorUserId: actor.id,
    actorName: actor.fullName,
    action: "member.created",
    entityType: "member",
    entityId: member.id,
    after: { ...appointmentRecord(member, user, data.alternateFor) },
  });
  return member;
}

/** The content the official signs when appointing a member. */
export function appointmentRecord(
  member: typeof members.$inferSelect,
  user: Pick<User, "fullName" | "email">,
  alternateForIds: string[],
) {
  return {
    memberId: member.id,
    name: user.fullName,
    email: user.email.toLowerCase(),
    membershipType: member.membershipType,
    primaryConcern: member.primaryConcern,
    affiliated: member.affiliated,
    profession: member.profession,
    degrees: member.degrees,
    termEndsOn: member.termEndsOn,
    alternateFor: [...alternateForIds].sort(),
  };
}

/** The organizational official appoints a member by electronic signature (AAHRPP I.1.B, II.1.A). */
export async function appointMember(tx: Tx, actor: User, memberId: string, password: string) {
  requireRole(actor, "official");
  const [row] = await tx
    .select({ member: members, user: users })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.id, memberId))
    .limit(1);
  if (!row) throw new Error("Member not found.");
  if (row.member.status === "active") throw new Error("Member is already appointed.");
  const links = await tx
    .select({ id: alternateFor.primaryMemberId })
    .from(alternateFor)
    .where(eq(alternateFor.alternateMemberId, memberId));
  const record = appointmentRecord(row.member, row.user, links.map((l) => l.id));
  const signed = await signRecord(tx, {
    signerUserId: actor.id,
    password,
    meaning: "appointment",
    entityType: "member",
    entityId: memberId,
    record,
  });
  if (!signed.ok) return signed;
  const appointedAt = new Date();
  await tx.update(members).set({ status: "active", appointedAt }).where(eq(members.id, memberId));
  await recordAudit(tx, {
    actorUserId: actor.id,
    actorName: actor.fullName,
    action: "member.appointed",
    entityType: "member",
    entityId: memberId,
    before: { status: row.member.status },
    after: { status: "active", appointedAt: appointedAt.toISOString(), signatureId: signed.signature.id },
  });
  return signed;
}

export async function deactivateMember(tx: Tx, actor: User, memberId: string, reason: string) {
  requireRole(actor, "administrator", "official");
  if (!reason.trim()) throw new Error("A reason is required.");
  const [before] = await tx.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!before) throw new Error("Member not found.");
  await tx.update(members).set({ status: "inactive" }).where(eq(members.id, memberId));
  await recordAudit(tx, {
    actorUserId: actor.id,
    actorName: actor.fullName,
    action: "member.deactivated",
    entityType: "member",
    entityId: memberId,
    before: { status: before.status },
    after: { status: "inactive" },
    reason,
  });
}

export async function loadRoster(
  tx: Tx,
): Promise<(RosterMember & { email: string; expertise: string[]; degrees: string; experiencedReviewer: boolean })[]> {
  const rows = await tx
    .select({ member: members, user: users })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .orderBy(asc(members.membershipType), asc(users.fullName));
  const ids = rows.map((r) => r.member.id);
  const links = ids.length
    ? await tx.select().from(alternateFor).where(inArray(alternateFor.alternateMemberId, ids))
    : [];
  return rows.map(({ member, user }) => ({
    id: member.id,
    name: user.fullName,
    email: user.email,
    status: member.status,
    membershipType: member.membershipType,
    primaryConcern: member.primaryConcern,
    affiliated: member.affiliated,
    profession: member.profession,
    degrees: member.degrees,
    gender: member.gender,
    expertise: member.expertise,
    experiencedReviewer: member.experiencedReviewer,
    trainingCompletedOn: member.trainingCompletedOn,
    termEndsOn: member.termEndsOn,
    alternateFor: links.filter((l) => l.alternateMemberId === member.id).map((l) => l.primaryMemberId),
  }));
}

export async function boardStatus(tx: Tx) {
  const roster = await loadRoster(tx);
  return { roster, report: evaluateComposition(roster) };
}
