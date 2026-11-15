/**
 * Background worker for production: sends queued emails every 30 seconds and runs the daily jobs
 * once a day. Run it as a separate always-on process next to the web server.
 */
import { createDb } from "../src/db";
import { isoToday } from "../src/domain/roster";
import { runDailyJobs } from "../src/lib/daily";
import { deliverEmails, smtpMailer } from "../src/lib/email";

async function main() {
  const { db } = createDb(process.env.DATABASE_URL ?? "postgres://irb@localhost:5433/irb");
  const mailer = smtpMailer();
  if (!mailer) console.warn("SMTP_URL is not set: emails will wait in the outbox.");
  let lastDaily = "";
  for (;;) {
    try {
      if (lastDaily !== isoToday()) {
        console.log("daily", JSON.stringify(await db.transaction((tx) => runDailyJobs(tx))));
        lastDaily = isoToday();
      }
      if (mailer) {
        const r = await deliverEmails(db, mailer);
        if (r.tried) console.log("email", JSON.stringify(r));
      }
    } catch (e) {
      console.error(e);
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
main();
