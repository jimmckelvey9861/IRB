import { randomInt } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { complaints, studies } from "@/db/schema";
import { recordAudit } from "./audit";
import type { User } from "./auth/service";
import { requireRole } from "./members";
import { notify, usersWithRole } from "./notify";
import { fileEventReport } from "./oversight";

export const FROM_ROLES = {
  participant: "A research participant",
  family: "A participant's family member or representative",
  staff: "Study staff",
  other: "Someone else",
} as const;

export const ComplaintSchema = z.object({
  fromRole: z.enum(Object.keys(FROM_ROLES) as [keyof typeof FROM_ROLES, ...(keyof typeof FROM_ROLES)[]]),
  studyReference: z.string().trim().max(200).default(""),
  message: z.string().trim().min(10, "Please tell us a little more (at least 10 characters).").max(5000),
  contactName: z.string().trim().max(200).default(""),
  contactDetail: z.string().trim().max(200).default(""),
});

/** No ambiguous letters, so people can read it back over the phone. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newReference() {
  return "C-" + Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

/**
 * Anyone can raise a complaint, question or concern without an account, and anonymously if they
 * wish (AAHRPP Standard I-4). The chair and administrator are told at once.
 */
export async function submitComplaint(tx: Tx, input: z.input<typeof ComplaintSchema>) {
  const data = ComplaintSchema.parse(input);
  const match = data.studyReference.match(/IRB-\d{4}-\d{4}/i)?.[0]?.toUpperCase();
  const [study] = match ? await tx.select().from(studies).where(eq(studies.irbNumber, match)).limit(1) : [];
  const [c] = await tx
    .insert(complaints)
    .values({ ...data, reference: newReference(), studyId: study?.id ?? null })
    .returning();
  await recordAudit(tx, {
    actorUserId: null,
    actorName: "public form",
    action: "complaint.received",
    entityType: "complaint",
    entityId: c.id,
    after: { reference: c.reference, fromRole: c.fromRole, studyId: c.studyId },
  });
  const staff = [...(await usersWithRole(tx, "chair")), ...(await usersWithRole(tx, "administrator"))];
  await notify(tx, staff, {
    subject: `New concern ${c.reference}${study ? ` about ${study.irbNumber}` : ""}`,
    body: "Respond within 5 business days (SOP-11).",
    link: `/complaints#${c.reference}`,
  });
  return c;
}

/** What the person who raised it can see, using only their reference code. */
export async function complaintByReference(tx: Tx, reference: string) {
  const [c] = await tx.select().from(complaints).where(eq(complaints.reference, reference.trim().toUpperCase())).limit(1);
  if (!c) return null;
  return { reference: c.reference, receivedAt: c.receivedAt, status: c.status, response: c.response };
}

/**
 * The chair or administrator responds. If it suggests harm to participants or noncompliance, they
 * refer it, which files a problem report on the study for a formal determination (SOP-10).
 */
export async function respondToComplaint(tx: Tx, actor: User, id: string, response: string, refer: boolean) {
  requireRole(actor, "chair", "administrator");
  if (response.trim().length < 10) throw new Error("Write a response (at least 10 characters).");
  const [c] = await tx.select().from(complaints).where(eq(complaints.id, id)).limit(1);
  if (!c) throw new Error("Not found.");
  if (c.status !== "open") throw new Error("This has already been answered.");
  let eventReportId: string | null = null;
  if (refer) {
    if (!c.studyId) throw new Error("Link it to a study before referring it: the person did not give a recognizable IRB number.");
    const ev = await fileEventReport(tx, actor, c.studyId, {
      kind: "complaint",
      occurredOn: c.receivedAt.toISOString().slice(0, 10),
      description: `Concern ${c.reference} (${FROM_ROLES[c.fromRole as keyof typeof FROM_ROLES] ?? c.fromRole}):\n${c.message}`,
    });
    eventReportId = ev.id;
  }
  await tx
    .update(complaints)
    .set({ status: refer ? "referred" : "responded", response: response.trim(), respondedById: actor.id, respondedAt: new Date(), eventReportId })
    .where(eq(complaints.id, id));
  await recordAudit(tx, {
    actorUserId: actor.id,
    actorName: actor.fullName,
    action: refer ? "complaint.referred" : "complaint.responded",
    entityType: "complaint",
    entityId: id,
    after: { response: response.trim(), eventReportId },
  });
}

export async function linkComplaintToStudy(tx: Tx, actor: User, id: string, irbNumber: string) {
  requireRole(actor, "chair", "administrator");
  const [study] = await tx.select().from(studies).where(eq(studies.irbNumber, irbNumber.trim().toUpperCase())).limit(1);
  if (!study) throw new Error(`No study ${irbNumber}.`);
  await tx.update(complaints).set({ studyId: study.id }).where(eq(complaints.id, id));
  await recordAudit(tx, { actorUserId: actor.id, actorName: actor.fullName, action: "complaint.linked", entityType: "complaint", entityId: id, after: { studyId: study.id } });
}

export async function listComplaints(tx: Tx, actor: User) {
  requireRole(actor, "chair", "administrator", "official");
  return tx
    .select({ complaint: complaints, irbNumber: studies.irbNumber })
    .from(complaints)
    .leftJoin(studies, eq(studies.id, complaints.studyId))
    .orderBy(desc(complaints.receivedAt));
}
