import { desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { payouts } from "@/db/schema";
import { EARNING_LABELS, formatCents, type EarningKind } from "@/domain/earnings";
import { requireUser } from "@/lib/auth/session";
import { rateFor, runPayout, setRate } from "@/lib/pay";
import { AppShell } from "@/components/app-shell";
import { Card, ErrorNote, PrimaryButton } from "@/components/ui";

const KINDS = Object.keys(EARNING_LABELS) as EarningKind[];

async function saveRates(formData: FormData) {
  "use server";
  const actor = await requireUser();
  try {
    await db.transaction(async (tx) => {
      for (const k of KINDS) {
        const dollars = Number(formData.get(k));
        const cents = Math.round(dollars * 100);
        if (Number.isFinite(dollars) && cents !== (await rateFor(tx, k))) await setRate(tx, actor, k, cents);
      }
    });
  } catch (e) {
    redirect(`/pay?error=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath("/pay");
  redirect("/pay?ok=Rates%20saved%3B%20they%20apply%20to%20work%20done%20from%20now%20on.");
}

async function payNow() {
  "use server";
  const actor = await requireUser();
  let result: Awaited<ReturnType<typeof runPayout>> = null;
  try {
    result = await db.transaction((tx) => runPayout(tx, actor, new Date().toISOString().slice(0, 10)));
  } catch (e) {
    redirect(`/pay?error=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath("/pay");
  redirect(result ? `/pay?ok=${encodeURIComponent(`Payout of ${formatCents(result.payout.totalCents)} created.`)}&csv=${encodeURIComponent(result.csv)}` : "/pay?ok=Nothing%20is%20due.");
}

export default async function PayPage({ searchParams }: PageProps<"/pay">) {
  const user = await requireUser();
  if (!user.roles.includes("administrator")) redirect("/");
  const { error, ok, csv } = await searchParams;
  const rates = await Promise.all(KINDS.map(async (k) => ({ k, cents: await rateFor(db, k) })));
  const history = await db.select().from(payouts).orderBy(desc(payouts.createdAt)).limit(20);
  const input = "w-28 rounded border border-neutral-300 bg-transparent px-2 py-1 text-right dark:border-neutral-700";
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Member pay</h1>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}
      {typeof csv === "string" && (
        <Card title="Payment file (CSV) for payroll">
          <pre className="text-xs whitespace-pre-wrap">{csv}</pre>
        </Card>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card title="Rates (US dollars)">
          <form action={saveRates} className="space-y-2 text-sm">
            {rates.map(({ k, cents }) => (
              <label key={k} className="flex items-center justify-between gap-3">
                <span>{EARNING_LABELS[k]}</span>
                <input name={k} type="number" step="0.01" min="0" defaultValue={(cents / 100).toFixed(2)} className={input} />
              </label>
            ))}
            <p className="text-xs text-neutral-500">Rates never depend on the board&apos;s decision (FDA IRB FAQ 8). There is no bonus for speed; availability is paid through the on-call stipend.</p>
            <PrimaryButton>Save rates</PrimaryButton>
          </form>
        </Card>
        <Card title="Payouts">
          <form action={payNow}>
            <PrimaryButton>Create this week&apos;s payout</PrimaryButton>
          </form>
          <ul className="mt-3 space-y-1 text-sm">
            {history.map((p) => (
              <li key={p.id}>{p.createdAt.toISOString().slice(0, 10)} · through {p.periodEnd} · {formatCents(p.totalCents)}</li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
