import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { myAssignments } from "@/lib/submissions";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status";

export default async function ReviewsPage() {
  const user = await requireUser();
  const rows = await myAssignments(db, user);
  const open = rows.filter((r) => r.assignment.status === "assigned");
  const done = rows.filter((r) => r.assignment.status !== "assigned");
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">My reviews</h1>
      <h2 className="mt-6 text-sm font-semibold text-neutral-500 uppercase">To do ({open.length})</h2>
      <List rows={open} />
      <h2 className="mt-8 text-sm font-semibold text-neutral-500 uppercase">Done ({done.length})</h2>
      <List rows={done} />
    </AppShell>
  );
}

function List({ rows }: { rows: Awaited<ReturnType<typeof myAssignments>> }) {
  if (!rows.length) return <p className="mt-2 text-sm text-neutral-500">Nothing here.</p>;
  return (
    <ul className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
      {rows.map(({ assignment, study, submission }) => (
        <li key={assignment.id}>
          <Link href={`/reviews/${assignment.id}`} className="block py-3">
            <div className="flex items-center gap-2">
              <StatusBadge status={assignment.status} />
              <span className="text-xs text-neutral-500">{submission.path === "expedited" ? "Expedited" : "Full board"}</span>
            </div>
            <div className="mt-1 font-medium">{study.title}</div>
            <div className="font-mono text-xs text-neutral-500">{study.irbNumber}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
