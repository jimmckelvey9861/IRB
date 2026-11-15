import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type DB } from "@/db";
import { hashPassword } from "@/lib/auth/password";
import { users } from "@/db/schema";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Drops everything and re-applies migrations, giving each test file an empty database. */
export async function freshDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const { db, pool } = createDb(TEST_DATABASE_URL);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: "drizzle" });
  return { db, close: () => pool.end() };
}

export async function makeUser(
  db: DB,
  fullName: string,
  roles: (typeof users.$inferInsert)["roles"],
  password = "test password 123",
) {
  const [u] = await db
    .insert(users)
    .values({
      email: `${fullName.toLowerCase().replace(/\s+/g, ".")}@example.test`,
      fullName,
      passwordHash: await hashPassword(password),
      roles,
    })
    .returning();
  return u;
}
