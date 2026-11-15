/** Daily job: renewal, training and policy-review reminders, and lapse checks. Schedule it once a day on the hosting account. */
import { createDb } from "../src/db";
import { runDailyJobs } from "../src/lib/daily";

async function main() {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://irb@localhost:5433/irb");
  const result = await db.transaction((tx) => runDailyJobs(tx));
  console.log(JSON.stringify(result));
  await pool.end();
}
main();
