/** Daily job: renewal reminders and lapse checks. Schedule it once a day on the hosting account. */
import { createDb } from "../src/db";
import { runOversightSweep } from "../src/lib/oversight";

async function main() {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://irb@localhost:5433/irb");
  const result = await db.transaction((tx) => runOversightSweep(tx));
  console.log(JSON.stringify(result));
  await pool.end();
}
main();
