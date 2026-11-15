/**
 * Demo only: appoints the seeded board, files a full-board drug study, completes the pre-reviews,
 * marks everyone available, and books the meeting. Run after `npm run db:seed`. Never in production.
 */
import { eq } from "drizzle-orm";
import { createDb } from "../src/db";
import { members, users, availability } from "../src/db/schema";
import { appointMember } from "../src/lib/members";
import { createStudyDraft, saveConsentResolutions, submitForReview, myAssignments, declareConflict, completeReview } from "../src/lib/submissions";
import { autoSchedule } from "../src/lib/meetings";
import { APPROVAL_CRITERIA } from "../src/domain/review";
const PW = "demo password 2026";
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo only.");
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://irb@localhost:5433/irb");
  const byEmail = async (e: string) => (await db.select().from(users).where(eq(users.email, e)))[0];
  const official = await byEmail("official@demo.test");
  for (const m of await db.select().from(members)) await db.transaction((tx) => appointMember(tx, official, m.id, PW));
  const pi = await byEmail("investigator@demo.test");
  const consent = `This is a research study of an investigational drug for advanced lung cancer. Risks include nausea and fatigue; there may be risks that are not known.
You may or may not benefit. Alternatives include standard chemotherapy. Records may be inspected by the Food and Drug Administration.
If you are injured, treatment will be provided at no cost to you. If you have questions, contact Dr. Demo at 555-0100.
Taking part is voluntary; you may withdraw at any time without penalty. About 80 people will take part.
A description of this clinical trial will be available on http://www.ClinicalTrials.gov, as required by U.S. Law.`;
  const { submission } = await db.transaction((tx) => createStudyDraft(tx, pi, { title: "Phase 2 trial of ZX-101 in advanced lung cancer", sponsor: "Zeta Oncology", expertise: ["oncology"], summary: "Adults with advanced non-small-cell lung cancer receive ZX-101 every 3 weeks for up to 6 cycles, with scans every 6 weeks.", protocolText: "", consentText: consent, minimalRisk: false, expeditedCategory: null, applicableClinicalTrial: true, involvesChildren: false, involvesVulnerable: false }));
  await db.transaction((tx) => saveConsentResolutions(tx, pi, submission.id, ["investigator-termination", "additional-costs", "withdrawal-consequences", "new-findings"].map((id) => ({ elementId: id, location: "Sections 10-12" }))));
  console.log(JSON.stringify(await db.transaction((tx) => submitForReview(tx, pi, submission.id))));
  const all = Object.fromEntries(APPROVAL_CRITERIA.map((c) => [c.id, "met"])) as Record<string, "met">;
  for (const u of await db.select().from(users)) for (const a of await myAssignments(db, u)) {
    await db.transaction((tx) => declareConflict(tx, u, a.assignment.id, false, ""));
    console.log(u.fullName, JSON.stringify(await db.transaction((tx) => completeReview(tx, u, a.assignment.id, { answers: all, notes: "Reasonable design; consent form is long.", password: PW }))));
  }
  const now = Date.now();
  for (const m of await db.select().from(members)) await db.insert(availability).values({ memberId: m.id, startsAt: new Date(now - 60_000), endsAt: new Date(now + 3 * 3600_000), onCall: true });
  const chair = await byEmail("dr.maya.patel@demo.test");
  const r = await db.transaction((tx) => autoSchedule(tx, chair, { videoLink: "https://zoom.example/j/123" }));
  console.log(r.ok ? "meeting " + r.meeting.id : r.reason);
  await pool.end();
}
main();
