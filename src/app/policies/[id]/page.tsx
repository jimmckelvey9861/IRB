import { db } from "@/db";
import { isoToday } from "@/domain/roster";
import { addMonthsIso } from "@/domain/training";
import { requireUser } from "@/lib/auth/session";
import { policyDetail } from "@/lib/policies";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, ErrorNote, PrimaryButton } from "@/components/ui";
import { acknowledge, approve, reviewed, save } from "../actions";

const input = "mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-2 dark:border-neutral-700";

export default async function PolicyPage({ params, searchParams }: PageProps<"/policies/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const { policy, versions, acknowledged } = await policyDetail(db, user, id);
  const current = versions.find((v) => v.status === "in_effect");
  const draft = versions.find((v) => v.status === "draft");
  const canEdit = user.roles.includes("administrator") || user.roles.includes("chair");
  const isOfficial = user.roles.includes("official");
  const reviewSoon = !!current?.reviewDueOn && current.reviewDueOn <= addMonthsIso(isoToday(), 1);

  return (
    <AppShell user={user}>
      <p className="font-mono text-xs text-neutral-500">{policy.code}</p>
      <h1 className="text-2xl font-semibold">{policy.title}</h1>
      <p className="mt-1 text-xs text-neutral-500">Based on: {policy.sources}</p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}

      <div className="mt-6 grid gap-4">
        {current && (
          <Card title={`Version ${current.version}, in effect since ${current.effectiveFrom}`}>
            <pre className="font-sans text-sm whitespace-pre-wrap">{current.body}</pre>
            <p className="mt-3 font-mono text-xs text-neutral-500">Approved by e-signature · next review due {current.reviewDueOn} · fingerprint {current.bodyHash.slice(0, 16)}</p>
            <div className="mt-4 flex flex-wrap gap-4">
              {acknowledged ? (
                <Badge tone="good">You confirmed you read this version</Badge>
              ) : (
                <form action={acknowledge}>
                  <input type="hidden" name="policyId" value={policy.id} />
                  <input type="hidden" name="versionId" value={current.id} />
                  <button className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white">I have read this version</button>
                </form>
              )}
            </div>
            {isOfficial && reviewSoon && (
              <form action={reviewed} className="mt-4 flex flex-wrap gap-2 text-sm">
                <input type="hidden" name="policyId" value={policy.id} />
                <input type="hidden" name="versionId" value={current.id} />
                <input name="password" type="password" required placeholder="Your password, to sign" className="flex-1 rounded border border-neutral-300 px-2 py-2 dark:border-neutral-700" />
                <button className="rounded-md border border-neutral-400 px-3 py-2">Sign yearly review: still accurate, no changes</button>
              </form>
            )}
          </Card>
        )}

        {draft && (
          <Card title={`Draft version ${draft.version}${draft.changeSummary ? `: ${draft.changeSummary}` : ""}`}>
            {canEdit ? (
              <form action={save} className="space-y-3 text-sm">
                <input type="hidden" name="policyId" value={policy.id} />
                <textarea name="body" rows={16} defaultValue={draft.body} className={`${input} font-mono text-xs`} />
                <input name="changeSummary" defaultValue={draft.changeSummary} placeholder="What changed and why" className={input} />
                <PrimaryButton>Save draft</PrimaryButton>
              </form>
            ) : (
              <pre className="font-sans text-sm whitespace-pre-wrap">{draft.body}</pre>
            )}
            {isOfficial && (
              <form action={approve} className="mt-4 flex flex-wrap gap-2 text-sm">
                <input type="hidden" name="policyId" value={policy.id} />
                <input type="hidden" name="versionId" value={draft.id} />
                <input name="password" type="password" required placeholder="Your password, to sign" className="flex-1 rounded border border-neutral-300 px-2 py-2 dark:border-neutral-700" />
                <button className="rounded-md bg-blue-700 px-3 py-2 text-white">Approve and put in effect</button>
              </form>
            )}
          </Card>
        )}

        {current && !draft && canEdit && (
          <details className="rounded-lg border border-neutral-200 p-5 text-sm dark:border-neutral-800">
            <summary className="cursor-pointer font-semibold">Draft a revision</summary>
            <form action={save} className="mt-3 space-y-3">
              <input type="hidden" name="policyId" value={policy.id} />
              <textarea name="body" rows={16} defaultValue={current.body} className={`${input} font-mono text-xs`} />
              <input name="changeSummary" required placeholder="What changed and why" className={input} />
              <PrimaryButton>Save as a draft</PrimaryButton>
            </form>
          </details>
        )}

        {versions.filter((v) => v.status === "superseded").length > 0 && (
          <Card title="Earlier versions">
            <ul className="space-y-1 text-sm">
              {versions
                .filter((v) => v.status === "superseded")
                .map((v) => (
                  <li key={v.id}>Version {v.version}, in effect from {v.effectiveFrom}{v.changeSummary && ` · ${v.changeSummary}`}</li>
                ))}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
