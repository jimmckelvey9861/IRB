import Link from "next/link";
import { db } from "@/db";
import { EVENT_LABELS, REPORT_LABELS, type Determination } from "@/domain/oversight";
import { EXPEDITED_CATEGORIES } from "@/domain/review";
import { isoToday } from "@/domain/roster";
import { requireUser } from "@/lib/auth/session";
import { studyOversight } from "@/lib/oversight";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status";
import { Badge, Card, ErrorNote, PrimaryButton } from "@/components/ui";
import { close, determine, reportEvent, signReport, startFollowOn } from "../actions";

const input = "mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-2 dark:border-neutral-700";
const KIND = { initial: "Initial review", amendment: "Amendment", continuing: "Continuing review" } as const;
const STUDY_TONE = { active: "good", closed: "neutral", lapsed: "bad", suspended: "bad", terminated: "bad" } as const;

export default async function StudyPage({ params, searchParams }: PageProps<"/studies/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const v = await studyOversight(db, user, id);
  const { study, approval } = v;
  const isPi = study.principalInvestigatorId === user.id;
  const canDetermine = !isPi && (user.roles.includes("chair") || user.roles.includes("member"));
  const isOfficial = user.roles.includes("official");
  const canRenew = isPi && study.approvalExpiresOn && (study.status === "active" || study.status === "lapsed");
  const canAmend = isPi && study.approvalExpiresOn && (study.status === "active" || study.status === "lapsed" || study.status === "suspended");

  return (
    <AppShell user={user}>
      <p className="font-mono text-xs text-neutral-500">{study.irbNumber}</p>
      <h1 className="text-2xl font-semibold">{study.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={STUDY_TONE[study.status]}>{study.status}</Badge>
        <span>Sponsor: {study.sponsor}</span>
        {approval.state === "current" && (
          <span>
            Approved through {study.approvalExpiresOn} ({approval.daysLeft} days left)
            {approval.daysLeft <= 60 && <> · <Badge tone="warn">continuing review due</Badge></>}
          </span>
        )}
        {approval.state === "lapsed" && <span className="text-red-800">Approval ended {approval.daysOver} day(s) ago</span>}
      </p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}

      {(study.status === "lapsed" || study.status === "suspended" || study.status === "terminated") && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          Research activity must stop: no new enrollment and no research procedures. If stopping would harm a participant already enrolled, report it below right away so the IRB can decide whether they may continue.
        </p>
      )}

      <div className="mt-6 grid gap-4">
        <Card title="Submissions">
          <ul className="space-y-2 text-sm">
            {v.submissions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={s.status} />
                <Link className="underline" href={`/submissions/${s.id}`}>{KIND[s.kind]}</Link>
                <span className="text-neutral-500">{(s.submittedAt ?? s.createdAt).toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Card>

        {(canRenew || canAmend) && (
          <Card title="Renew or change this study">
            <form action={startFollowOn} className="space-y-3 text-sm">
              <input type="hidden" name="studyId" value={study.id} />
              <label className="block">
                <span className="font-medium">What are you submitting?</span>
                <select name="kind" className={input} defaultValue={canRenew && approval.state !== "none" && (approval.state === "lapsed" || approval.daysLeft <= 60) ? "continuing" : "amendment"}>
                  {canRenew && <option value="continuing">Continuing review (yearly re-review, 21 CFR 56.109(f))</option>}
                  {canAmend && <option value="amendment">Amendment (a change to the study; it may not start until approved)</option>}
                </select>
              </label>
              <label className="block">
                <span className="font-medium">Summary</span>
                <textarea name="summary" rows={3} required className={input} placeholder="For a renewal: progress since the last review. For an amendment: what changes and why." />
              </label>
              <fieldset className="grid gap-3 rounded-md border border-neutral-200 p-3 md:grid-cols-2 dark:border-neutral-800">
                <legend className="px-1 font-medium">Progress report (continuing review only)</legend>
                <label>Participants enrolled in total<input name="enrolledTotal" type="number" min={0} className={input} /></label>
                <label>Enrolled since the last review<input name="enrolledSinceLastReview" type="number" min={0} className={input} /></label>
                <label>Withdrawn or lost to follow-up<input name="withdrawn" type="number" min={0} className={input} /></label>
                <label className="flex items-center gap-2 md:mt-6"><input type="checkbox" name="enrollmentOpen" value="yes" defaultChecked /> Enrollment is still open</label>
                <label className="md:col-span-2">Problems, complaints or new information since the last review<textarea name="problemsSummary" rows={2} className={input} /></label>
              </fieldset>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2"><input type="checkbox" name="minimalRisk" value="yes" /> The research is no more than minimal risk</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="minorChange" value="yes" /> Amendment: minor change, no added risk</label>
              </div>
              <label className="block">
                <span className="font-medium">Expedited category, if any</span>
                <select name="expeditedCategory" className={input} defaultValue="">
                  <option value="">None</option>
                  {EXPEDITED_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.id}. {c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="font-medium">Revised consent form (leave empty to keep the approved one)</span>
                <textarea name="consentText" rows={3} className={input} />
              </label>
              <PrimaryButton>Save draft</PrimaryButton>
            </form>
          </Card>
        )}

        <Card title="Problem reports (21 CFR 56.108(b))">
          {v.events.length === 0 && <p className="text-sm text-neutral-500">None reported.</p>}
          <div className="space-y-4">
            {v.events.map((e) => {
              const d = e.determination as Determination | null;
              const reports = v.reports.filter((r) => r.eventReportId === e.id);
              return (
                <div key={e.id} id={`event-${e.id}`} className="scroll-mt-20 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge tone={e.status === "determined" ? "good" : "warn"}>{e.status === "determined" ? "determined" : "awaiting determination"}</Badge>
                    <span className="font-medium">{EVENT_LABELS[e.kind]}</span>
                    <span className="text-neutral-500">occurred {e.occurredOn}</span>
                  </p>
                  <p className="mt-2 whitespace-pre-wrap">{e.description}</p>
                  {d && (
                    <p className="mt-2 text-neutral-700 dark:text-neutral-300">
                      Finding: {d.isUnanticipatedProblem ? "unanticipated problem" : "not an unanticipated problem"}; noncompliance {d.noncompliance}; action {d.action.replace("_", " ")}. {d.rationale}
                    </p>
                  )}
                  {canDetermine && e.status !== "determined" && (
                    <form action={determine} className="mt-3 grid gap-3 md:grid-cols-2">
                      <input type="hidden" name="studyId" value={study.id} />
                      <input type="hidden" name="eventId" value={e.id} />
                      <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="isUnanticipatedProblem" value="yes" /> Unexpected, related to the research, and puts people at greater risk (an unanticipated problem)</label>
                      <label>Noncompliance
                        <select name="noncompliance" className={input} defaultValue="none">
                          <option value="none">None</option><option value="minor">Minor</option><option value="serious">Serious</option><option value="continuing">Continuing</option>
                        </select>
                      </label>
                      <label>Action
                        <select name="action" className={input} defaultValue="none">
                          <option value="none">None needed</option>
                          <option value="require_modifications">Require changes (investigator submits an amendment)</option>
                          {user.roles.includes("chair") && <option value="suspend">Suspend approval (urgent; board reviews it next meeting)</option>}
                          {user.roles.includes("chair") && <option value="terminate">Terminate approval</option>}
                        </select>
                      </label>
                      <label className="md:col-span-2">Reasoning<textarea name="rationale" rows={2} required className={input} /></label>
                      <input name="password" type="password" required placeholder="Your password, to sign" className={input} />
                      <PrimaryButton>Sign determination</PrimaryButton>
                    </form>
                  )}
                  {reports.map((r) => (
                    <details key={r.id} className="mt-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                      <summary className="cursor-pointer">
                        <Badge tone={r.status === "signed" ? "good" : "warn"}>{r.status}</Badge> {REPORT_LABELS[r.kind]}
                      </summary>
                      <pre className="mt-2 text-xs whitespace-pre-wrap">{r.body}</pre>
                      <a className="mt-2 inline-block text-xs underline" href={`/reports/${r.id}/pdf`}>Download as PDF to send</a>
                      {r.status === "draft" && isOfficial && (
                        <form action={signReport} className="mt-2 flex flex-wrap gap-2">
                          <input type="hidden" name="studyId" value={study.id} />
                          <input type="hidden" name="reportId" value={r.id} />
                          <input name="password" type="password" required placeholder="Your password, to sign" className="flex-1 rounded border border-neutral-300 px-2 py-2 dark:border-neutral-700" />
                          <button className="rounded-md bg-neutral-900 px-3 py-2 text-white">Sign report</button>
                        </form>
                      )}
                      {r.signedAt && <p className="mt-2 font-mono text-xs text-neutral-500">Signed {r.signedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · fingerprint {r.bodyHash.slice(0, 16)}</p>}
                    </details>
                  ))}
                </div>
              );
            })}
          </div>

          {study.status !== "closed" && (
            <details className="mt-4 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <summary className="cursor-pointer font-medium">Report a problem</summary>
              <form action={reportEvent} className="mt-3 space-y-3">
                <input type="hidden" name="studyId" value={study.id} />
                <label className="block">What kind?
                  <select name="kind" className={input}>
                    {Object.entries(EVENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                <label className="block">When did it happen?<input name="occurredOn" type="date" required max={isoToday()} className={input} /></label>
                <label className="block">What happened? (no names or other identifiers)<textarea name="description" rows={3} required className={input} /></label>
                <PrimaryButton>Send to the IRB</PrimaryButton>
              </form>
            </details>
          )}
        </Card>
        {study.status !== "closed" && (isPi || user.roles.includes("chair")) && study.approvalExpiresOn && (
          <details className="rounded-lg border border-neutral-200 p-5 text-sm dark:border-neutral-800">
            <summary className="cursor-pointer font-semibold">Close the study (all research activity has ended)</summary>
            <form action={close} className="mt-3 space-y-3">
              <input type="hidden" name="studyId" value={study.id} />
              <label className="block">Final report: how many took part, how many completed, and any problems not yet reported
                <textarea name="finalReport" rows={3} required className={input} />
              </label>
              <PrimaryButton>Close the study</PrimaryButton>
            </form>
          </details>
        )}
        {study.retainUntil && <p className="text-sm text-neutral-500">Closed. Records kept until at least {study.retainUntil} (21 CFR 56.115(b)).</p>}
      </div>
    </AppShell>
  );
}
