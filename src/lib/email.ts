import { and, asc, eq, lt } from "drizzle-orm";
import nodemailer from "nodemailer";
import type { DB } from "@/db";
import { emailOutbox } from "@/db/schema";

export const MAX_ATTEMPTS = 5;

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/**
 * SMTP mailer from SMTP_URL (for example Amazon SES's SMTP endpoint, which AWS covers under its HIPAA
 * business associate agreement). Returns null when not configured, so emails wait in the outbox.
 */
export function smtpMailer(): Mailer | null {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  const from = process.env.MAIL_FROM ?? "IRB <no-reply@localhost>";
  const transport = nodemailer.createTransport(url);
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}

/** Sends queued emails one by one. Each row commits on its own so a failure never resends others. */
export async function deliverEmails(db: DB, mailer: Mailer, limit = 50) {
  const queued = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "queued"), lt(emailOutbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(emailOutbox.createdAt))
    .limit(limit);
  let sent = 0;
  for (const e of queued) {
    try {
      await mailer.send(e.toEmail, e.subject, e.body);
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date(), attempts: e.attempts + 1 }).where(eq(emailOutbox.id, e.id));
      sent++;
    } catch (err) {
      const attempts = e.attempts + 1;
      await db
        .update(emailOutbox)
        .set({ attempts, lastError: String((err as Error).message ?? err).slice(0, 500), status: attempts >= MAX_ATTEMPTS ? "failed" : "queued" })
        .where(eq(emailOutbox.id, e.id));
    }
  }
  return { sent, tried: queued.length };
}
