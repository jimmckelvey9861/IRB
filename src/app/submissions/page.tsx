import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { listSubmissionsFor } from "@/lib/submissions";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status";

export default async function SubmissionsPage() {
  const user = await requireUser();
  const rows = await listSubmissionsFor(db, user);
  const canCreate = user.roles.some((r) => r === "investigator" || r === "administrator");
  return (
    <AppShell user={user}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Submissions</h1>
        {canCreate && (
          <Link href="/submissions/new" className="rounded-md bg-blue-700 px-3 py-2 text-sm text-white">
            New study
          </Link>
        )}
      </div>
      <ul className="mt-6 divide-y divide-neutral-200 dark:divide-neutral-800">
        {rows.map(({ submission, study }) => (
          <li key={submission.id} className="py-3">
            <Link href={`/submissions/${submission.id}`} className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs text-neutral-500">{study.irbNumber}</span>
              <span className="font-medium">{study.title}</span>
              <StatusBadge status={submission.status} />
              {submission.path && (
                <span className="text-xs text-neutral-500">{submission.path === "expedited" ? "Expedited" : "Full board"}</span>
              )}
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="py-6 text-neutral-500">No submissions yet.</li>}
      </ul>
    </AppShell>
  );
}
