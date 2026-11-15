/**
 * Loads made-up demo data into a local database. Never run against production.
 *
 *   npm run db:seed
 */
import { count } from "drizzle-orm";
import { createDb } from "../src/db";
import { users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { createMember } from "../src/lib/members";

const PASSWORD = process.env.DEMO_PASSWORD ?? "demo password 2026";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://irb@localhost:5433/irb";
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to load demo data in production.");
  const { db, pool } = createDb(url);
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) {
    console.log("Database already has users; skipping demo data.");
    await pool.end();
    return;
  }
  const hash = await hashPassword(PASSWORD);
  const [admin] = await db
    .insert(users)
    .values({ email: "admin@demo.test", fullName: "Demo Administrator", passwordHash: hash, roles: ["administrator"] })
    .returning();
  await db
    .insert(users)
    .values({ email: "official@demo.test", fullName: "Demo Official", passwordHash: hash, roles: ["official"] });

  const people = [
    { fullName: "Dr. Maya Patel", profession: "physician", degrees: "MD", primaryConcern: "scientific", affiliated: true, expertise: ["oncology"], gender: "female" },
    { fullName: "Dr. Samuel Okafor", profession: "pharmacist", degrees: "PharmD", primaryConcern: "scientific", affiliated: true, expertise: ["pharmacology"], gender: "male" },
    { fullName: "Grace Lindqvist", profession: "nurse", degrees: "RN, BSN", primaryConcern: "scientific", affiliated: true, expertise: ["clinical operations"], gender: "female" },
    { fullName: "Robert Chen", profession: "attorney", degrees: "JD", primaryConcern: "nonscientific", affiliated: true, expertise: ["law", "privacy"], gender: "male" },
    { fullName: "Elena Ruiz", profession: "teacher", degrees: "BA", primaryConcern: "nonscientific", affiliated: false, expertise: ["community"], gender: "female" },
  ] as const;
  const ids: Record<string, string> = {};
  for (const p of people) {
    const m = await db.transaction((tx) =>
      createMember(tx, admin, {
        ...p,
        expertise: [...p.expertise],
        email: `${p.fullName.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@demo.test`,
        temporaryPassword: PASSWORD,
        membershipType: "primary",
        trainingCompletedOn: "2026-10-01",
        alternateFor: [],
      }),
    );
    ids[p.fullName] = m.id;
  }
  await db.transaction((tx) =>
    createMember(tx, admin, {
      fullName: "Pastor James Whitfield",
      email: "james.whitfield@demo.test",
      temporaryPassword: PASSWORD,
      membershipType: "alternate",
      primaryConcern: "nonscientific",
      affiliated: false,
      profession: "clergy",
      degrees: "MDiv",
      expertise: ["ethics"],
      gender: "male",
      trainingCompletedOn: "2026-10-01",
      alternateFor: [ids["Elena Ruiz"]],
    }),
  );
  await pool.end();
  console.log(`Demo data loaded. Sign in as admin@demo.test or official@demo.test with password "${PASSWORD}".`);
  console.log("Members are pending appointment; sign in as the official to appoint them.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
