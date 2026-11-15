import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { members, users } from "@/db/schema";
import { TEST_DATABASE_URL, freshDb, makeUser } from "@/test/db";
import { recordAudit, verifyAuditChain } from "./audit";
import { MAX_FAILED_ATTEMPTS, checkCredentials, completeMfa, createSession, getSessionByToken, beginTotpEnrollment } from "./auth/service";
import { totpCode } from "./auth/totp";
import { signRecord, signaturesFor, verifySignature } from "./esign";
import { appointMember, boardStatus, createMember, PermissionError } from "./members";

const run = TEST_DATABASE_URL ? describe : describe.skip;

run("foundation (database)", () => {
  let db: DB;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await freshDb());
  });
  afterAll(async () => close?.());

  describe("audit trail [REQ-11.10(e)]", () => {
    it("chains entries and verifies", async () => {
      await db.transaction(async (tx) => {
        await recordAudit(tx, { actorUserId: null, actorName: "test", action: "a", entityType: "t", after: { x: 1 } });
        await recordAudit(tx, { actorUserId: null, actorName: "test", action: "b", entityType: "t", before: { x: 1 }, after: { x: 2, nested: { b: 1, a: [1, 2] } } });
      });
      const check = await verifyAuditChain(db);
      expect(check.ok).toBe(true);
      expect(check.entries).toBeGreaterThanOrEqual(2);
    });

    it("refuses to update, delete or truncate entries", async () => {
      await expect(db.execute(sql`update audit_events set action = 'tampered' where seq = 1`)).rejects.toThrow();
      await expect(db.execute(sql`delete from audit_events where seq = 1`)).rejects.toThrow();
      await expect(db.execute(sql`truncate audit_events`)).rejects.toThrow();
    });

    it("detects tampering even by someone who bypasses the trigger", async () => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`alter table audit_events disable trigger audit_events_no_update_delete`);
        await tx.execute(sql`update audit_events set action = 'tampered' where seq = 1`);
        const check = await verifyAuditChain(tx);
        expect(check.ok).toBe(false);
        expect(check.firstBadSeq).toBe(1);
        tx.rollback();
      }).catch((e) => {
        if (!String(e).includes("Rollback")) throw e;
      });
      expect((await verifyAuditChain(db)).ok).toBe(true);
    });
  });

  describe("sign-in [REQ-11.300]", () => {
    it("requires password then authenticator code", async () => {
      const u = await makeUser(db, "Sign In Person", ["member"]);
      const creds = await db.transaction((tx) => checkCredentials(tx, u.email, "test password 123"));
      expect(creds.ok).toBe(true);
      const { token, session } = await createSession(db, u.id);
      const secret = await beginTotpEnrollment(db, session);
      const live = await getSessionByToken(db, token);
      expect(live?.session.mfaVerified).toBe(false);
      expect(await completeMfa(db, live!.session, live!.user, "000000")).toBe(false);
      const fresh = (await getSessionByToken(db, token))!;
      expect(await completeMfa(db, fresh.session, fresh.user, totpCode(secret))).toBe(true);
      expect((await getSessionByToken(db, token))?.session.mfaVerified).toBe(true);
      const [saved] = await db.select().from(users).where(eq(users.id, u.id));
      expect(saved.totpSecret).toBe(secret);
    });

    it(`locks the account after ${MAX_FAILED_ATTEMPTS} wrong passwords`, async () => {
      const u = await makeUser(db, "Lockout Person", ["member"]);
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
        await db.transaction((tx) => checkCredentials(tx, u.email, "wrong password 1"));
      }
      const r = await db.transaction((tx) => checkCredentials(tx, u.email, "test password 123"));
      expect(r).toEqual({ ok: false, reason: "locked" });
    });
  });

  describe("e-signatures [REQ-11.50, REQ-11.70, REQ-11.200]", () => {
    it("re-checks the password and binds the signature to the record content", async () => {
      const u = await makeUser(db, "Signer Person", ["chair"]);
      const record = { decision: "approved", protocol: "P-1" };
      const bad = await db.transaction((tx) =>
        signRecord(tx, { signerUserId: u.id, password: "nope nope nope 1", meaning: "approval", entityType: "x", entityId: "1", record }),
      );
      expect(bad.ok).toBe(false);
      const good = await db.transaction((tx) =>
        signRecord(tx, { signerUserId: u.id, password: "test password 123", meaning: "approval", entityType: "x", entityId: "1", record }),
      );
      expect(good.ok).toBe(true);
      const [sig] = await signaturesFor(db, "x", "1");
      expect(sig.signerName).toBe("Signer Person");
      expect(sig.meaning).toBe("Approval");
      expect(verifySignature(sig, { protocol: "P-1", decision: "approved" })).toBe(true);
      expect(verifySignature(sig, { protocol: "P-1", decision: "disapproved" })).toBe(false);
      await expect(db.execute(sql`delete from signatures`)).rejects.toThrow();
    });
  });

  describe("roster and appointment [REQ-56.107, AAHRPP II.1.A]", () => {
    it("only counts members once the official signs their appointment", async () => {
      const admin = await makeUser(db, "Admin Person", ["administrator"]);
      const official = await makeUser(db, "Official Person", ["official"]);
      const specs = [
        { n: "Dr Ana", c: "scientific", a: true, p: "physician" },
        { n: "Dr Ben", c: "scientific", a: true, p: "pharmacist" },
        { n: "Cal Nurse", c: "scientific", a: true, p: "nurse" },
        { n: "Dee Lawyer", c: "nonscientific", a: true, p: "attorney" },
        { n: "Eve Teacher", c: "nonscientific", a: false, p: "teacher" },
      ] as const;
      const ids: string[] = [];
      for (const s of specs) {
        const mem = await db.transaction((tx) =>
          createMember(tx, admin, {
            fullName: s.n,
            email: `${s.n.replace(/\s/g, "")}@example.test`,
            temporaryPassword: "temporary pass 123",
            membershipType: "primary",
            primaryConcern: s.c,
            affiliated: s.a,
            profession: s.p,
            degrees: "",
            expertise: [],
            trainingCompletedOn: "2026-01-01",
            alternateFor: [],
          }),
        );
        ids.push(mem.id);
      }
      expect((await boardStatus(db)).report.canOperate).toBe(false);

      await expect(db.transaction((tx) => appointMember(tx, admin, ids[0], "test password 123"))).rejects.toBeInstanceOf(PermissionError);

      for (const id of ids) {
        const r = await db.transaction((tx) => appointMember(tx, official, id, "test password 123"));
        expect(r.ok).toBe(true);
      }
      const status = await boardStatus(db);
      expect(status.report.canOperate).toBe(true);
      const [m0] = await db.select().from(members).where(eq(members.id, ids[0]));
      expect(m0.status).toBe("active");
      expect((await signaturesFor(db, "member", ids[0]))[0].meaning).toBe("Appointment of IRB member");
      expect((await verifyAuditChain(db)).ok).toBe(true);
    });
  });
});
