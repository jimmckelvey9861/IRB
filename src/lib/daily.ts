import type { Tx } from "@/db";
import { isoToday } from "@/domain/roster";
import { runOversightSweep } from "./oversight";
import { policyReviewSweep } from "./policies";
import { trainingReminderSweep } from "./training";

/** Everything that should happen once a day. Each step is idempotent, so running it more often is harmless. */
export async function runDailyJobs(tx: Tx, today = isoToday()) {
  const oversight = await runOversightSweep(tx, today);
  const trainingReminders = await trainingReminderSweep(tx, today);
  const policyReminders = await policyReviewSweep(tx, today);
  return { ...oversight, trainingReminders, policyReminders };
}
