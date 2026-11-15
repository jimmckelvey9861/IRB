import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { requireRole } from "@/lib/members";
import { listQaReviews, previousQuarter, qualityFlags, qualityMetrics, signQaReview, TARGETS } from "@/lib/quality";
import { isoToday } from "@/domain/roster";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, ErrorNote, PrimaryButton } from "@/components/ui";

const input = "mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-2 dark:border-neutral-700";

async function sign(formData: FormData) {
  "use server";
  const actor = await requireUser();
  const get = (k: string) => String(formData.get(k) ?? "");
  let r;
  try {
    r = await db.transaction((tx) => signQaReview(tx, actor, { periodStart: get("from"), periodEnd: get("to"), findings: get("findings"), actions: get("actions") }, get("password")));
  } catch (e) {
    redirect(`/quality?error=${encodeURIComponent((e as Error).message)}`);
  }
  if (!r.ok) redirect(`/quality?error=${encodeURIComponent(r.problem)}`);
  redirect("/quality?ok=Quarterly%20review%20signed%20and%20filed.");
}

function Stat({ label, value, bad }: { label: string; value: string | number; bad?: boolean }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${bad ? "text-red-700" : ""}`}>{value}</p>
    </div>
  );
}

export default async function QualityPage({ searchParams }: PageProps<"/quality">) {
  const user = await requireUser();
  requireRole(user, "chair", "official", "administrator");
  const sp = await searchParams;
  const q = previousQuarter();
  const from = typeof sp.from === "string" ? sp.from : q.from;
  const to = typeof sp.to === "string" ? sp.to : isoToday();
  const m = await qualityMetrics(db, from, to);
  const flags = qualityFlags(m);
  const reviews = await listQaReviews(db);
  const canSign = user.roles.includes("chair") || user.roles.includes("official");
  const h = (x: number | null) => (x === null ? "none" : `${x} h`);

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Quality dashboard</h1>
      <form className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <label>From<input name="from" type="date" defaultValue={from} className={input} /></label>
        <label>To<input name="to" type="date" defaultValue={to} className={input} /></label>
        <button className="rounded-md border border-neutral-400 px-3 py-2">Show</button>
      </form>
      {typeof sp.error === "string" && <ErrorNote>{sp.error}</ErrorNote>}
      {typeof sp.ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{sp.ok}</p>}

      <div className="mt-6 grid gap-4">
        <Card title={flags.length ? `Needs attention (${flags.length})` : "Everything is on target"}>
          {flags.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{flags.map((f) => <li key={f}>{f}</li>)}</ul> : <Badge tone="good">No flags</Badge>}
        </Card>
        <Card title="Speed (this period)">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Expedited decisions" value={m.expedited.decided} />
            <Stat label={`Expedited median (target ${TARGETS.expeditedHours} h)`} value={h(m.expedited.medianHours)} bad={(m.expedited.medianHours ?? 0) > TARGETS.expeditedHours} />
            <Stat label="Full-board decisions" value={m.fullBoard.decided} />
            <Stat label="Full-board median" value={h(m.fullBoard.medianHours)} />
          </div>
        </Card>
        <Card title="Backlog (now)">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={`Reviews open > ${TARGETS.reviewOpenDays} days`} value={m.backlog.overdueReviews} bad={m.backlog.overdueReviews > 0} />
            <Stat label={`Determinations > ${TARGETS.determinationDays} days`} value={m.backlog.overdueDeterminations} bad={m.backlog.overdueDeterminations > 0} />
            <Stat label={`Unsigned reports > ${TARGETS.reportSignDays} days`} value={m.backlog.overdueReports} bad={m.backlog.overdueReports > 0} />
            <Stat label={`Concerns open > ${TARGETS.complaintDays} days`} value={m.backlog.openComplaintsOverdue} bad={m.backlog.openComplaintsOverdue > 0} />
            <Stat label="Lapsed studies" value={m.backlog.lapsedStudies} bad={m.backlog.lapsedStudies > 0} />
          </div>
        </Card>
        <Card title="Program (this period)">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Approved / changes / disapproved" value={`${m.outcomes.approved} / ${m.outcomes.modificationsRequired} / ${m.outcomes.disapproved}`} />
            <Stat label="Meetings held" value={m.meetings.held} />
            <Stat label="Concerns received" value={m.complaintsReceived} />
            <Stat label="Approval lapses" value={m.lapsesInPeriod} bad={m.lapsesInPeriod > 0} />
            <Stat label="Reviewers with current training" value={`${m.training.reviewers - m.training.notCurrent.length} of ${m.training.reviewers}`} bad={m.training.notCurrent.length > 0} />
            <Stat label="Policies in effect" value={m.policies.inEffect} />
            <Stat label="Policy reviews overdue" value={m.policies.reviewOverdue} bad={m.policies.reviewOverdue > 0} />
            <Stat label="Audit trail" value={m.auditTrail.ok ? "intact" : "problem"} bad={!m.auditTrail.ok} />
          </div>
        </Card>

        {canSign && (
          <Card title="Sign the quarterly review (SOP-13)">
            <form action={sign} className="space-y-3 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <label>Period from<input name="from" type="date" defaultValue={q.from} className={input} /></label>
                <label>to<input name="to" type="date" defaultValue={q.to} className={input} /></label>
              </div>
              <label className="block">Findings<textarea name="findings" rows={3} required defaultValue={flags.join("\n")} className={input} /></label>
              <label className="block">Actions agreed (who, what, by when)<textarea name="actions" rows={3} required className={input} /></label>
              <input name="password" type="password" required placeholder="Your password, to sign" className={input} />
              <PrimaryButton>Sign and file</PrimaryButton>
            </form>
          </Card>
        )}

        <Card title="Signed reviews">
          {reviews.length === 0 && <p className="text-sm text-neutral-500">None yet.</p>}
          <ul className="space-y-3 text-sm">
            {reviews.map((r) => (
              <li key={r.id}>
                <p className="font-medium">{r.periodStart} to {r.periodEnd}</p>
                <p className="whitespace-pre-wrap">{r.findings}</p>
                <p className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">Actions: {r.actions}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
