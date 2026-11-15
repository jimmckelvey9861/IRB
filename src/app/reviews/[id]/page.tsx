import { db } from "@/db";
import { APPROVAL_CRITERIA } from "@/domain/review";
import { requireUser } from "@/lib/auth/session";
import { getAssignmentForReviewer } from "@/lib/submissions";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status";
import { Card, ErrorNote, PrimaryButton } from "@/components/ui";
import { submitConflict, submitReview } from "../actions";

const input = "rounded border border-neutral-300 bg-transparent px-2 py-2 dark:border-neutral-700";

export default async function ReviewPage({ params, searchParams }: PageProps<"/reviews/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const { assignment, submission, study, declaration } = await getAssignmentForReviewer(db, user, id);
  const expedited = submission.path === "expedited";
  const open = assignment.status === "assigned";

  return (
    <AppShell user={user}>
      <p className="font-mono text-xs text-neutral-500">{study.irbNumber}</p>
      <h1 className="text-xl font-semibold md:text-2xl">{study.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={assignment.status} />
        <span>{expedited ? "Expedited review: your decision is the IRB's decision." : "Full board: your assessment goes to the convened meeting, which decides."}</span>
      </p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}

      {open && !declaration && (
        <div className="mt-6">
          <Card title="First: any conflict of interest?">
            <p className="text-sm">
              You may not review a study in which you have a conflicting interest, such as a financial interest in
              the sponsor or a role in the study (21 CFR 56.107(e)). If you do, you will be replaced at once.
            </p>
            <form action={submitConflict} className="mt-4 space-y-3 text-sm">
              <input type="hidden" name="assignmentId" value={assignment.id} />
              <label className="flex items-center gap-2"><input type="radio" name="hasConflict" value="no" required /> I have no conflict with this study or its sponsor ({study.sponsor})</label>
              <label className="flex items-center gap-2"><input type="radio" name="hasConflict" value="yes" /> I have a conflict</label>
              <input name="details" placeholder="If yes, briefly describe it" className={`w-full ${input}`} />
              <PrimaryButton>Continue</PrimaryButton>
            </form>
          </Card>
        </div>
      )}

      {(declaration && !declaration.hasConflict) || !open ? (
        <div className="mt-6 grid gap-4">
          <Card title="Study summary">
            <p className="text-sm whitespace-pre-wrap">{submission.summary}</p>
            <p className="mt-2 text-xs text-neutral-500">Review path: {submission.pathBasis}</p>
          </Card>
          <Card title="Consent form">
            <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">{submission.consentText}</pre>
          </Card>
          {submission.protocolText && (
            <Card title="Protocol">
              <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">{submission.protocolText}</pre>
            </Card>
          )}
          {open ? (
            <Card title="Approval criteria (21 CFR 56.111)">
              <form action={submitReview} className="space-y-5 text-sm">
                <input type="hidden" name="assignmentId" value={assignment.id} />
                {APPROVAL_CRITERIA.map((c) => (
                  <fieldset key={c.id}>
                    <legend><span className="font-medium">{c.cfr}</span> {c.text}</legend>
                    <div className="mt-1 flex flex-wrap gap-4">
                      <label className="flex items-center gap-1"><input type="radio" name={`c:${c.id}`} value="met" required /> Met</label>
                      <label className="flex items-center gap-1"><input type="radio" name={`c:${c.id}`} value="not_met" /> Not met</label>
                      {c.naAllowed && <label className="flex items-center gap-1"><input type="radio" name={`c:${c.id}`} value="na" /> Not applicable</label>}
                    </div>
                  </fieldset>
                ))}
                <label className="block">
                  <span className="font-medium">Notes{expedited ? "" : " for the meeting"}</span>
                  <textarea name="notes" rows={3} className={`mt-1 w-full ${input}`} />
                </label>
                {expedited && (
                  <>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="confirmsExpedited" value="yes" className="mt-1" />
                      <span>I confirm this study qualifies for expedited review ({submission.pathBasis}).</span>
                    </label>
                    <fieldset>
                      <legend className="font-medium">Decision</legend>
                      <div className="mt-1 space-y-1">
                        <label className="flex items-center gap-2"><input type="radio" name="decision" value="approve" required /> Approve</label>
                        <label className="flex items-center gap-2"><input type="radio" name="decision" value="require_modifications" /> Require changes</label>
                        <label className="flex items-center gap-2"><input type="radio" name="decision" value="refer_to_full_board" /> Refer to the full board</label>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">An expedited reviewer cannot disapprove; refer to the full board instead (21 CFR 56.110(b)).</p>
                    </fieldset>
                    <label className="block">
                      <span className="font-medium">If approving: approval period in months (1 to 12)</span>
                      <input name="approvalMonths" type="number" min={1} max={12} className={`mt-1 w-32 ${input}`} />
                    </label>
                    <label className="block">
                      <span className="font-medium">Required changes, or reason for referral</span>
                      <textarea name="explanation" rows={3} className={`mt-1 w-full ${input}`} />
                    </label>
                  </>
                )}
                <label className="block">
                  <span className="font-medium">Your password, to sign electronically</span>
                  <input name="password" type="password" required autoComplete="current-password" className={`mt-1 w-full ${input}`} />
                </label>
                <PrimaryButton>Sign and submit</PrimaryButton>
              </form>
            </Card>
          ) : (
            <Card title="Your signed review">
              <p className="text-sm">Completed {assignment.completedAt?.toISOString().slice(0, 16).replace("T", " ")} UTC{assignment.decision ? ` · decision: ${assignment.decision.replace(/_/g, " ")}` : ""}</p>
              {assignment.notes && <p className="mt-2 text-sm whitespace-pre-wrap">{assignment.notes}</p>}
            </Card>
          )}
        </div>
      ) : null}
    </AppShell>
  );
}
