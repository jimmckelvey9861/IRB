import { and, desc, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { availability, members } from "@/db/schema";
import { EARNING_LABELS, formatCents } from "@/domain/earnings";
import { requireUser } from "@/lib/auth/session";
import { addAvailability, memberEarnings, recordEndedOnCallWindows } from "@/lib/pay";
import { AppShell } from "@/components/app-shell";
import { Card, ErrorNote, PrimaryButton } from "@/components/ui";

async function addWindow(formData: FormData) {
  "use server";
  const actor = await requireUser();
  const startsAt = new Date(String(formData.get("startsAt")) + "Z");
  const endsAt = new Date(String(formData.get("endsAt")) + "Z");
  try {
    await db.transaction((tx) => addAvailability(tx, actor, startsAt, endsAt, formData.get("onCall") === "yes"));
  } catch (e) {
    redirect(`/earnings?error=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath("/earnings");
  redirect("/earnings?ok=Availability%20saved.");
}

export default async function EarningsPage({ searchParams }: PageProps<"/earnings">) {
  const user = await requireUser();
  const { error, ok } = await searchParams;
  const [m] = await db.select().from(members).where(eq(members.userId, user.id)).limit(1);
  if (!m) {
    return (
      <AppShell user={user}>
        <p>Only IRB members have earnings.</p>
      </AppShell>
    );
  }
  await recordEndedOnCallWindows(db);
  const { rows, unpaidCents, paidCents } = await memberEarnings(db, m.id);
  const mine = await db
    .select()
    .from(availability)
    .where(and(eq(availability.memberId, m.id), gte(availability.endsAt, new Date())))
    .orderBy(desc(availability.startsAt));
  const input = "mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-2 dark:border-neutral-700";

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">My availability and earnings</h1>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card title="Earnings">
          <p className="text-3xl font-semibold tabular-nums">{formatCents(unpaidCents)}</p>
          <p className="text-sm text-neutral-500">to be paid in the next weekly payout · {formatCents(paidCents)} paid so far</p>
          <p className="mt-2 text-xs text-neutral-500">Pay is a flat rate per completed review or meeting, plus an hourly on-call stipend. It is the same whatever the board decides.</p>
        </Card>
        <Card title="When I'm available">
          <form action={addWindow} className="space-y-3 text-sm">
            <label className="block"><span className="font-medium">From (UTC)</span><input name="startsAt" type="datetime-local" required className={input} /></label>
            <label className="block"><span className="font-medium">Until (UTC)</span><input name="endsAt" type="datetime-local" required className={input} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" name="onCall" value="yes" /> On call: I commit to join a meeting within the hour if called (earns the stipend)</label>
            <PrimaryButton>Save</PrimaryButton>
          </form>
          {mine.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {mine.map((w) => (
                <li key={w.id}>{w.startsAt.toISOString().slice(0, 16).replace("T", " ")} to {w.endsAt.toISOString().slice(11, 16)} UTC{w.onCall ? " · on call" : ""}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="mt-6">
        <Card title="Recent work">
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500"><tr><th className="py-1">Date</th><th>Work</th><th className="text-right">Amount</th><th className="text-right">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-900">
                  <td className="py-1 tabular-nums">{r.earnedAt.toISOString().slice(0, 10)}</td>
                  <td>{EARNING_LABELS[r.kind]}{r.quantity > 1 ? ` × ${r.quantity}` : ""}</td>
                  <td className="text-right tabular-nums">{formatCents(r.amountCents)}</td>
                  <td className="text-right">{r.payoutId ? "Paid" : `Pays after ${r.periodEnd}`}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="py-2 text-neutral-500">No earnings yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </AppShell>
  );
}
