import { db } from "@/db";
import { unresolvedElements, type ElementResolution } from "@/domain/consent";
import { requireUser } from "@/lib/auth/session";
import { consentCheckFor, getSubmissionForViewer, submissionDetail } from "@/lib/submissions";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status";
import { Badge, Card, ErrorNote, PrimaryButton } from "@/components/ui";
import { resolveAndSubmit } from "../actions";

export default async function SubmissionPage({ params, searchParams }: PageProps<"/submissions/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const { submission, study } = await getSubmissionForViewer(db, user, id);
  const detail = await submissionDetail(db, id);
  const check = consentCheckFor(submission);
  const resolutions = submission.consentResolutions as ElementResolution[];
  const open = new Set(unresolvedElements(check, resolutions).map((e) => e.id));
  const needsAttention = [...check.missingRequired, ...check.missingAdditional];
  const isOwner = study.principalInvestigatorId === user.id || user.roles.includes("administrator");
  const editable = isOwner && submission.status === "draft";
  const isIrb = user.roles.some((r) => r === "member" || r === "chair" || r === "official" || r === "administrator");

  return (
    <AppShell user={user}>
      <p className="font-mono text-xs text-neutral-500">{study.irbNumber}</p>
      <h1 className="text-2xl font-semibold">{study.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge status={submission.status} />
        <span>Sponsor: {study.sponsor}</span>
        {submission.path && <span>{submission.path === "expedited" ? "Expedited review" : "Full board review"}: {submission.pathBasis}</span>}
        {study.approvalExpiresOn && <span>Approved through {study.approvalExpiresOn}</span>}
      </p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}

      <div className="mt-6 grid gap-4">
        <Card title="Consent form check (21 CFR 50.25)">
          {needsAttention.length === 0 ? (
            <p className="text-sm">
              <Badge tone="good">Complete</Badge> Every required element was found.
            </p>
          ) : (
            <form action={resolveAndSubmit} className="space-y-4 text-sm">
              <input type="hidden" name="submissionId" value={submission.id} />
              <p>
                The checker could not find these elements. For each, say where the form covers it
                {check.missingAdditional.length > 0 && ", or for optional elements, why it does not apply"}.
              </p>
              {needsAttention.map((el) => {
                const r = resolutions.find((x) => x.elementId === el.id);
                return (
                  <div key={el.id} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                    <p className="flex items-center gap-2">
                      <Badge tone={open.has(el.id) ? (el.kind === "additional" ? "warn" : "bad") : "good"}>
                        {open.has(el.id) ? (el.kind === "additional" ? "optional" : "required") : "resolved"}
                      </Badge>
                      <span className="font-medium">{el.cfr}</span> {el.label}
                    </p>
                    {editable && (
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <input name={`loc:${el.id}`} defaultValue={r?.location} placeholder="Where it is covered, e.g. Section 4, page 2" className="rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700" />
                        {el.kind === "additional" && (
                          <input name={`na:${el.id}`} defaultValue={r?.notApplicableBecause} placeholder="Or: why it does not apply" className="rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700" />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {editable && <PrimaryButton>Save and send to the IRB</PrimaryButton>}
            </form>
          )}
          {needsAttention.length === 0 && editable && (
            <form action={resolveAndSubmit} className="mt-4">
              <input type="hidden" name="submissionId" value={submission.id} />
              <PrimaryButton>Send to the IRB</PrimaryButton>
            </form>
          )}
        </Card>

        {isIrb && detail.assignments.length > 0 && (
          <Card title="Reviewers">
            <ul className="space-y-2 text-sm">
              {detail.assignments.map(({ assignment, name }) => (
                <li key={assignment.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={assignment.status} />
                  <span className="font-medium">{name}</span>
                  <span className="text-neutral-500">{assignment.role === "primary_reviewer" ? "primary" : "secondary"} · {assignment.reason}</span>
                </li>
              ))}
            </ul>
            {submission.consultantNeeded && (
              <p className="mt-3 text-sm"><Badge tone="warn">Consultant needed</Badge> No available member has the expertise this study needs; invite a non-voting consultant (AAHRPP II.1.E).</p>
            )}
          </Card>
        )}

        {detail.letters.map((l) => (
          <Card key={l.id} title={`Letter: ${l.subject}`}>
            <pre className="text-sm whitespace-pre-wrap">{l.body}</pre>
            <p className="mt-2 font-mono text-xs text-neutral-500">Issued {l.issuedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · fingerprint {l.bodyHash.slice(0, 16)}</p>
          </Card>
        ))}

        <Card title="Summary">
          <p className="text-sm whitespace-pre-wrap">{submission.summary}</p>
        </Card>
      </div>
    </AppShell>
  );
}
