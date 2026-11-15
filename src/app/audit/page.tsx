import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { verifyAuditChain } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui";

export default async function AuditPage() {
  const user = await requireUser();
  const [rows, chain] = await Promise.all([
    db.select().from(auditEvents).orderBy(desc(auditEvents.seq)).limit(200),
    verifyAuditChain(db),
  ]);
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Audit trail</h1>
      <p className="mt-2 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        {chain.ok ? <Badge tone="good">Chain intact</Badge> : <Badge tone="bad">Tampering detected</Badge>}
        Every entry is permanent and linked to the one before it, so any change to history is detectable
        (21 CFR 11.10(e)). Showing the latest {rows.length}.
      </p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="py-2 pr-4">#</th>
              <th className="py-2 pr-4">When (UTC)</th>
              <th className="py-2 pr-4">Who</th>
              <th className="py-2 pr-4">Action</th>
              <th className="py-2 pr-4">Record</th>
              <th className="py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seq} className="border-b border-neutral-100 align-top dark:border-neutral-900">
                <td className="py-2 pr-4 tabular-nums">{r.seq}</td>
                <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                  {r.occurredAt.toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td className="py-2 pr-4">{r.actorName ?? "—"}</td>
                <td className="py-2 pr-4 font-mono text-xs">{r.action}</td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {r.entityType}
                  {r.entityId ? `:${r.entityId.slice(0, 8)}` : ""}
                </td>
                <td className="py-2 font-mono text-xs break-all text-neutral-500">
                  {r.reason && <div>reason: {r.reason}</div>}
                  {r.after != null && <div>{JSON.stringify(r.after)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
