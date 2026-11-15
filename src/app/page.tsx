import Link from "next/link";
import { db } from "@/db";
import { verifyAuditChain } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { boardStatus } from "@/lib/members";
import { myNotifications } from "@/lib/notify";
import { runDailyJobs } from "@/lib/daily";
import { dismissNotice } from "./studies/actions";
import { AppShell } from "@/components/app-shell";
import { Badge, Card } from "@/components/ui";

export default async function Overview() {
  const user = await requireUser();
  // The daily jobs are idempotent; until a scheduled job runs it daily on the hosting account, opening the overview runs it.
  await db.transaction((tx) => runDailyJobs(tx));
  const [{ report, roster }, chain, notices] = await Promise.all([boardStatus(db), verifyAuditChain(db), myNotifications(db, user.id)]);
  const unread = notices.filter((n) => !n.readAt);
  const blocking = report.issues.filter((i) => i.severity === "blocking");
  const pending = roster.filter((m) => m.status === "pending_appointment").length;

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="mt-6">
        <Card title={unread.length ? `For you (${unread.length})` : "For you"}>
          {unread.length === 0 && <p className="text-sm text-neutral-500">Nothing new.</p>}
          <ul className="space-y-2 text-sm">
            {unread.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start gap-2">
                <div className="flex-1">
                  {n.link ? <Link href={n.link} className="font-medium underline">{n.subject}</Link> : <span className="font-medium">{n.subject}</span>}
                  {n.body && <p className="text-neutral-600 dark:text-neutral-400">{n.body}</p>}
                </div>
                <form action={dismissNotice}>
                  <input type="hidden" name="id" value={n.id} />
                  <button className="text-xs text-neutral-500 underline">Dismiss</button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Can the board review research?">
          <p className="flex items-center gap-2">
            {report.canOperate ? <Badge tone="good">Yes</Badge> : <Badge tone="bad">No</Badge>}
            <span className="text-sm">
              {report.activePrimaryCount} appointed primary members
              {pending > 0 && `, ${pending} awaiting appointment`}
            </span>
          </p>
          {blocking.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {blocking.map((i) => (
                <li key={i.code + (i.memberId ?? "")}>{i.message}</li>
              ))}
            </ul>
          )}
          <Link href="/roster" className="mt-3 inline-block text-sm underline">
            Open the roster
          </Link>
        </Card>
        <Card title="Audit trail integrity">
          <p className="flex items-center gap-2">
            {chain.ok ? <Badge tone="good">Intact</Badge> : <Badge tone="bad">Problem found</Badge>}
            <span className="text-sm">
              {chain.entries} entries checked{!chain.ok && ` · entry ${chain.firstBadSeq}: ${chain.problem}`}
            </span>
          </p>
          <Link href="/audit" className="mt-3 inline-block text-sm underline">
            View the audit trail
          </Link>
        </Card>
      </div>
    </AppShell>
  );
}
