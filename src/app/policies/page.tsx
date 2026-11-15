import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { listPolicies } from "@/lib/policies";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, ErrorNote, PrimaryButton } from "@/components/ui";
import { installStarter } from "./actions";

export default async function PoliciesPage({ searchParams }: PageProps<"/policies">) {
  const user = await requireUser();
  const { error, ok } = await searchParams;
  const staff = user.roles.some((r) => r !== "investigator");
  const rows = (await listPolicies(db, user.id)).filter((r) => staff || r.current);
  const isAdmin = user.roles.includes("administrator");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Policies and procedures</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">The IRB&apos;s written procedures. Each version is approved by the organizational official&apos;s signature and reviewed yearly.</p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}
      <div className="mt-6 grid gap-4">
        {rows.length === 0 && (
          <Card title="No procedures yet">
            {isAdmin ? (
              <form action={installStarter} className="space-y-3 text-sm">
                <p>Load 15 starter procedures written to match how this system works. They arrive as drafts for review and approval.</p>
                <PrimaryButton>Load the starter procedures</PrimaryButton>
              </form>
            ) : (
              <p className="text-sm">The administrator has not loaded any procedures yet.</p>
            )}
          </Card>
        )}
        {rows.length > 0 && (
          <Card title={`${rows.filter((r) => r.current).length} of ${rows.length} in effect`}>
            <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-900">
              {rows.map(({ policy, current, draft, acknowledged }) => (
                <li key={policy.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-16 font-mono text-xs">{policy.code}</span>
                  <Link className="flex-1 underline" href={`/policies/${policy.id}`}>{policy.title}</Link>
                  {current ? <Badge tone="good">v{current.version} in effect</Badge> : <Badge tone="warn">not yet approved</Badge>}
                  {staff && draft && current && <Badge tone="neutral">revision drafted</Badge>}
                  {current && !acknowledged && staff && <Badge tone="warn">please read</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
