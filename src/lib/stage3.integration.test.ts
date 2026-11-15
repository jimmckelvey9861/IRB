import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { complaints, eventReports, members, notifications, policyVersions } from "@/db/schema";
import { STARTER_POLICIES } from "@/domain/policy-library";
import { isoToday } from "@/domain/roster";
import { addMonthsIso } from "@/domain/training";
import { TEST_DATABASE_URL, freshDb, makeUser } from "@/test/db";
import { verifyAuditChain } from "./audit";
import type { User } from "./auth/service";
import { complaintByReference, linkComplaintToStudy, listComplaints, respondToComplaint, submitComplaint } from "./complaints";
import { runDailyJobs } from "./daily";
import {
  acknowledgePolicy,
  approvePolicyVersion,
  confirmPolicyReviewed,
  installStarterPolicies,
  listPolicies,
  policyDetail,
  saveDraft,
} from "./policies";
import { listQaReviews, previousQuarter, qualityFlags, qualityMetrics, signQaReview } from "./quality";
import { createStudyDraft } from "./submissions";
import { recordTraining, trainingFor } from "./training";

const run = TEST_DATABASE_URL ? describe : describe.skip;
const PW = "test password 123";

function daysFrom(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

run("policies, training, complaints and quality review (database)", () => {
  let db: DB;
  let close: () => Promise<void>;
  let admin: User, official: User, chair: User, member: User, pi: User;

  beforeAll(async () => {
    ({ db, close } = await freshDb());
    admin = await makeUser(db, "Ada Admin", ["administrator"]);
    official = await makeUser(db, "Olive Official", ["official"]);
    chair = await makeUser(db, "Chris Chair", ["chair", "member"]);
    member = await makeUser(db, "Mel Member", ["member"]);
    pi = await makeUser(db, "Pat Investigator", ["investigator"]);
    await db.insert(members).values({ userId: member.id, status: "active", membershipType: "primary", primaryConcern: "scientific", affiliated: false, profession: "Pharmacist" });
  });
  afterAll(async () => close?.());

  it("loads starter policies as drafts, approves by signature and freezes approved text [REQ-AAHRPP-I-1]", async () => {
    await expect(db.transaction((tx) => installStarterPolicies(tx, chair))).rejects.toThrow(/administrator/);
    expect(await db.transaction((tx) => installStarterPolicies(tx, admin))).toBe(STARTER_POLICIES.length);
    expect(await db.transaction((tx) => installStarterPolicies(tx, admin))).toBe(0);

    const list = await listPolicies(db, member.id);
    const sop1 = list.find((l) => l.policy.code === "SOP-01")!;
    expect(sop1.current).toBeNull();
    await expect(policyDetail(db, pi, sop1.policy.id)).rejects.toThrow(/not in effect/);

    await expect(db.transaction((tx) => approvePolicyVersion(tx, chair, sop1.draft!.id, PW))).rejects.toThrow(/official/);
    const bad = await db.transaction((tx) => approvePolicyVersion(tx, official, sop1.draft!.id, "wrong password 1"));
    expect(bad.ok).toBe(false);
    expect((await db.transaction((tx) => approvePolicyVersion(tx, official, sop1.draft!.id, PW))).ok).toBe(true);

    const [v1] = await db.select().from(policyVersions).where(eq(policyVersions.id, sop1.draft!.id));
    expect(v1.status).toBe("in_effect");
    expect(v1.reviewDueOn).toBe(addMonthsIso(isoToday(), 12));
    await expect(db.execute(sql`update policy_versions set body = 'changed' where id = ${v1.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from policy_versions where id = ${v1.id}`)).rejects.toThrow();

    // Members are asked to read it, and can confirm they did.
    const asked = await db.select().from(notifications).where(eq(notifications.userId, member.id));
    expect(asked.some((n) => /SOP-01/.test(n.subject))).toBe(true);
    await db.transaction((tx) => acknowledgePolicy(tx, member, v1.id));
    expect((await listPolicies(db, member.id)).find((l) => l.policy.code === "SOP-01")!.acknowledged).toBe(true);

    // A revision becomes version 2 and supersedes version 1.
    const v2id = await db.transaction((tx) => saveDraft(tx, chair, sop1.policy.id, v1.body + "\n6. Added a clarification about reporting undue influence.", "Clarify reporting"));
    await db.transaction((tx) => approvePolicyVersion(tx, official, v2id, PW));
    const versions = (await policyDetail(db, official, sop1.policy.id)).versions;
    expect(versions.map((v) => [v.version, v.status])).toEqual([[2, "in_effect"], [1, "superseded"]]);
    expect((await listPolicies(db, member.id)).find((l) => l.policy.code === "SOP-01")!.acknowledged).toBe(false);
    expect((await policyDetail(db, pi, sop1.policy.id)).versions).toHaveLength(1);
  });

  it("reminds the official when a yearly policy review is due [REQ-AAHRPP-I-5]", async () => {
    const sop1 = (await listPolicies(db, official.id)).find((l) => l.policy.code === "SOP-01")!;
    const today = isoToday();
    await db.update(policyVersions).set({ reviewDueOn: daysFrom(today, 10) }).where(eq(policyVersions.id, sop1.current!.id));
    expect((await db.transaction((tx) => runDailyJobs(tx, today))).policyReminders).toBe(1);
    expect((await db.transaction((tx) => runDailyJobs(tx, today))).policyReminders).toBe(0);
    await db.transaction((tx) => confirmPolicyReviewed(tx, official, sop1.current!.id, PW));
    const [v] = await db.select().from(policyVersions).where(eq(policyVersions.id, sop1.current!.id));
    expect(v.reviewDueOn).toBe(addMonthsIso(today, 12));
  });

  it("records training, keeps reviewers' status current and reminds before expiry [REQ-AAHRPP-II-1, REQ-11.10(i)]", async () => {
    const today = isoToday();
    await expect(
      db.transaction((tx) => recordTraining(tx, pi, { userId: member.id, course: "human-subjects", completedOn: today, evidence: "CITI 123" })),
    ).rejects.toThrow(/administrator/);
    // Completed almost 3 years ago: current, but expiring in 30 days.
    const completed = daysFrom(addMonthsIso(today, -36), 30);
    await db.transaction((tx) => recordTraining(tx, admin, { userId: member.id, course: "human-subjects", completedOn: completed, evidence: "CITI 123" }));
    const [m] = await db.select().from(members).where(eq(members.userId, member.id));
    expect(m.trainingCompletedOn).toBe(completed);

    const st = (await trainingFor(db, member)).status;
    expect(st.find((s) => s.course.id === "human-subjects")).toMatchObject({ state: "current", daysLeft: 30 });
    expect(st.find((s) => s.course.id === "irb-orientation")!.state).toBe("missing");
    expect((await db.transaction((tx) => runDailyJobs(tx, today))).trainingReminders).toBe(1);

    await expect(db.execute(sql`delete from training_records`)).rejects.toThrow();
    await db.transaction((tx) => recordTraining(tx, member, { userId: member.id, course: "system", completedOn: today, evidence: "Completed in-app walkthrough" }));
    expect((await trainingFor(db, member)).status.find((s) => s.course.id === "system")!.state).toBe("current");
  });

  it("takes concerns from the public, answers them and refers harm to a problem report [REQ-AAHRPP-I-4]", async () => {
    const { study } = await db.transaction((tx) =>
      createStudyDraft(tx, pi, {
        title: "Fictional study",
        sponsor: "Example",
        expertise: [],
        summary: "A made-up study used to test the concerns process end to end.",
        protocolText: "",
        consentText: "This is a research study.",
        minimalRisk: true,
        expeditedCategory: 2,
        applicableClinicalTrial: true,
        involvesChildren: false,
        involvesVulnerable: false,
      }),
    );
    const anon = await db.transaction((tx) => submitComplaint(tx, { fromRole: "participant", message: "Nobody returned my calls about side effects.", studyReference: "" }));
    expect(anon.reference).toMatch(/^C-[A-Z2-9]{6}$/);
    expect(anon.studyId).toBeNull();
    const chairNotes = await db.select().from(notifications).where(eq(notifications.userId, chair.id));
    expect(chairNotes.some((n) => n.subject.includes(anon.reference))).toBe(true);

    expect(await complaintByReference(db, anon.reference.toLowerCase())).toMatchObject({ status: "open", response: null });
    expect(await complaintByReference(db, "C-NOPE00")).toBeNull();

    await expect(db.transaction((tx) => respondToComplaint(tx, chair, anon.id, "We are looking into this now.", true))).rejects.toThrow(/Link it/);
    await db.transaction((tx) => linkComplaintToStudy(tx, chair, anon.id, study.irbNumber));
    await db.transaction((tx) => respondToComplaint(tx, chair, anon.id, "Thank you. The IRB is reviewing this with the study team.", true));
    const [c] = await db.select().from(complaints).where(eq(complaints.id, anon.id));
    expect(c.status).toBe("referred");
    const [ev] = await db.select().from(eventReports).where(eq(eventReports.id, c.eventReportId!));
    expect(ev.kind).toBe("complaint");
    expect((await complaintByReference(db, anon.reference))!.response).toMatch(/reviewing/);

    const matched = await db.transaction((tx) => submitComplaint(tx, { fromRole: "family", message: "Question about parking costs for visits.", studyReference: `about ${study.irbNumber.toLowerCase()}` }));
    expect(matched.studyId).toBe(study.id);
    await expect(listComplaints(db, pi)).rejects.toThrow();
    expect(await listComplaints(db, official)).toHaveLength(2);
  });

  it("measures the program and records a signed quarterly review [REQ-AAHRPP-I-5]", async () => {
    const today = isoToday();
    const m = await qualityMetrics(db, daysFrom(today, -90), today);
    expect(m.complaintsReceived).toBe(2);
    expect(m.policies.inEffect).toBe(1);
    expect(m.training.notCurrent).toContain("Chris Chair");
    expect(m.auditTrail.ok).toBe(true);
    expect(qualityFlags(m).join(" ")).toMatch(/Training not current/);

    await expect(db.transaction((tx) => signQaReview(tx, member, { periodStart: daysFrom(today, -90), periodEnd: today, findings: "x".repeat(20), actions: "None" }, PW))).rejects.toThrow();
    const r = await db.transaction((tx) => signQaReview(tx, official, { periodStart: daysFrom(today, -90), periodEnd: today, findings: "Training gaps for the chair; follow up.", actions: "Chair to complete CITI by month end." }, PW));
    expect(r.ok).toBe(true);
    expect(await listQaReviews(db)).toHaveLength(1);
    await expect(db.execute(sql`update qa_reviews set findings = 'changed'`)).rejects.toThrow();
    expect(previousQuarter("2026-11-15")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(previousQuarter("2026-02-01")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
});
