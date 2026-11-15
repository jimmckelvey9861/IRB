import Link from "next/link";
import { db } from "@/db";
import { verifyAuditChain } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { boardStatus } from "@/lib/members";
import { AppShell } from "@/components/app-shell";
import { Badge, Card } from "@/components/ui";

export default async function Overview() {
  const user = await requireUser();
  const [{ report, roster }, chain] = await Promise.all([boardStatus(db), verifyAuditChain(db)]);
  const blocking = report.issues.filter((i) => i.severity === "blocking");
  const pending = roster.filter((m) => m.status === "pending_appointment").length;

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
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
