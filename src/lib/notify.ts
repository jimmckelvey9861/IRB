import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { emailOutbox, notifications, users } from "@/db/schema";

/** Where the app is served, for links in emails. */
export const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export interface Notice {
  subject: string;
  body?: string;
  link?: string;
  /** Repeating a notice with the same key for the same person does nothing. */
  dedupeKey?: string;
}

/** Queues an in-app notice. Email and push delivery come with the stage 3 hosting setup. */
export async function notify(tx: Tx, userIds: string[], n: Notice): Promise<number> {
  if (!userIds.length) return 0;
  const rows = await tx
    .insert(notifications)
    .values([...new Set(userIds)].map((userId) => ({ userId, subject: n.subject, body: n.body ?? "", link: n.link ?? "", dedupeKey: n.dedupeKey ?? null })))
    .onConflictDoNothing()
    .returning({ id: notifications.id, userId: notifications.userId });
  if (rows.length) {
    const people = await tx.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, rows.map((r) => r.userId)));
    const url = n.link ? `${APP_URL}${n.link}` : APP_URL;
    await tx.insert(emailOutbox).values(
      rows.map((r) => ({
        notificationId: r.id,
        toEmail: people.find((p) => p.id === r.userId)!.email,
        subject: n.subject,
        body: [n.body ?? "", "", `Open: ${url}`, "", "Sign in to see details. This message contains no participant information."].join("\n"),
      })),
    );
  }
  return rows.length;
}

/** Everyone holding a role, e.g. all chairs or all organizational officials. */
export async function usersWithRole(tx: Tx, role: (typeof users.$inferSelect)["roles"][number]): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(sql`${role} = any(${users.roles})`, isNull(users.disabledAt)));
  return rows.map((r) => r.id);
}

export function myNotifications(tx: Tx, userId: string, limit = 20) {
  return tx.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function markRead(tx: Tx, userId: string, id: string) {
  await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}
