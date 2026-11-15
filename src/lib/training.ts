import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { members, trainingRecords, users } from "@/db/schema";
import { isoToday } from "@/domain/roster";
import { COURSES, TRAINING_REMINDER_DAYS, expiryFor, trainingStatus, type TrainingRole } from "@/domain/training";
import { recordAudit } from "./audit";
import type { User } from "./auth/service";
import { PermissionError } from "./members";
import { notify } from "./notify";

export const TrainingSchema = z.object({
  userId: z.uuid(),
  course: z.enum(COURSES.map((c) => c.id) as [string, ...string[]]),
  completedOn: z.iso.date(),
  evidence: z.string().trim().min(3, "Give the certificate number, provider or other evidence."),
});

/**
 * Records a completed course. A person may record their own (with evidence); the administrator may
 * record anyone's. Human-subjects training also updates the member's roster entry, which controls
 * whether they can be assigned reviews.
 */
export async function recordTraining(tx: Tx, actor: User, input: z.input<typeof TrainingSchema>) {
  const data = TrainingSchema.parse(input);
  if (data.userId !== actor.id && !actor.roles.includes("administrator")) {
    throw new PermissionError("Only the administrator can record training for someone else.");
  }
  if (data.completedOn > isoToday()) throw new Error("The completion date cannot be in the future.");
  const [rec] = await tx
    .insert(trainingRecords)
    .values({ ...data, expiresOn: expiryFor(data.course, data.completedOn), recordedById: actor.id })
    .returning();
  await recordAudit(tx, {
    actorUserId: actor.id,
    actorName: actor.fullName,
    action: "training.recorded",
    entityType: "user",
    entityId: data.userId,
    after: { course: data.course, completedOn: data.completedOn, expiresOn: rec.expiresOn, evidence: data.evidence },
  });
  if (data.course === "human-subjects") {
    const [m] = await tx.select().from(members).where(eq(members.userId, data.userId)).limit(1);
    if (m && (!m.trainingCompletedOn || m.trainingCompletedOn < data.completedOn)) {
      await tx.update(members).set({ trainingCompletedOn: data.completedOn }).where(eq(members.id, m.id));
    }
  }
  return rec;
}

export async function trainingFor(tx: Tx, user: Pick<User, "id" | "roles">, today = isoToday()) {
  const recs = await tx.select().from(trainingRecords).where(eq(trainingRecords.userId, user.id)).orderBy(desc(trainingRecords.completedOn));
  return { records: recs, status: trainingStatus(user.roles as TrainingRole[], recs, today) };
}

/** Everyone's training at a glance, for the administrator and the quality review. */
export async function trainingMatrix(tx: Tx, today = isoToday()) {
  const people = await tx.select().from(users).where(isNull(users.disabledAt)).orderBy(users.fullName);
  const recs = await tx.select().from(trainingRecords);
  return people.map((u) => ({
    user: { id: u.id, fullName: u.fullName, roles: u.roles },
    status: trainingStatus(u.roles as TrainingRole[], recs.filter((r) => r.userId === u.id), today),
  }));
}

/** Reminds people 60, 30 and 7 days before a course expires. */
export async function trainingReminderSweep(tx: Tx, today = isoToday()) {
  let sent = 0;
  for (const row of await trainingMatrix(tx, today)) {
    for (const st of row.status) {
      if (st.state === "current" && st.daysLeft !== null && (TRAINING_REMINDER_DAYS as readonly number[]).includes(st.daysLeft)) {
        sent += await notify(tx, [row.user.id], {
          subject: `${st.course.label}: expires in ${st.daysLeft} days`,
          body: "Renew it and record the new completion, or you will not be assigned reviews.",
          link: "/training",
          dedupeKey: `training:${st.course.id}:${st.expiresOn}:${st.daysLeft}`,
        });
      }
    }
  }
  return sent;
}

