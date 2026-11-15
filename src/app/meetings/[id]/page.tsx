import { db } from "@/db";
import { APPROVAL_CRITERIA } from "@/domain/review";
import { requireUser } from "@/lib/auth/session";
import { meetingView } from "@/lib/meetings";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, ErrorNote, PrimaryButton } from "@/components/ui";
import { close, end, join, leave, propose, start, stepOut, vote } from "../actions";

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const input = "rounded border border-neutral-300 bg-transparent px-2 py-2 dark:border-neutral-700";
const MOTIONS = { approve: "Approve", require_modifications: "Require modifications", disapprove: "Disapprove", table: "Table (defer)" } as const;

export default async function MeetingPage({ params, searchParams }: PageProps<"/meetings/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { error, ok } = await searchParams;
  const v = await meetingView(db, id);
  const me = v.roster.find((r) => r.userId === user.id);
  const isChair = user.roles.includes("chair") || (me && v.meeting.chairMemberId === me.id);
  const live = v.meeting.status === "in_progress";
  const myAttendance = me && v.attendance.find((a) => a.memberId === me.id && !a.leftAt);
  const name = (memberId: string) => v.roster.find((r) => r.id === memberId)?.name ?? "unknown";
  const voteNow = v.items.find(
    ({ item }) => live && item.status === "voting" && me && v.perItem.find((p) => p.itemId === item.id)?.seats.votingMemberIds.includes(me.id),
  );

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Board meeting</h1>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={live ? "warn" : v.meeting.status === "adjourned" ? "good" : "neutral"}>{v.meeting.status.replace("_", " ")}</Badge>
        <span>{when(v.meeting.scheduledStart)} to {when(v.meeting.scheduledEnd).slice(11)}</span>
        {v.meeting.videoLink && <a className="underline" href={v.meeting.videoLink} target="_blank" rel="noreferrer">Join the video call</a>}
      </p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}

      {voteNow && (
        <a href={`#item-${voteNow.item.id}`} className="sticky top-0 z-10 mt-4 block rounded-md bg-amber-400 p-3 text-center font-medium text-amber-950">
          Voting is open on {voteNow.study.irbNumber}. Tap to vote.
        </a>
      )}

      <div className="mt-6 grid gap-4">
        {v.meeting.status === "scheduled" && isChair && (
          <form action={start}>
            <input type="hidden" name="meetingId" value={id} />
            <PrimaryButton>Call the meeting to order</PrimaryButton>
          </form>
        )}

        {live && (
          <Card title="Quorum (21 CFR 56.108(c))">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {v.general.quorum ? <Badge tone="good">Quorum present</Badge> : <Badge tone="bad">No quorum</Badge>}
              {v.general.votingMemberIds.length} of {v.general.totalSeats} seats filled;{" "}
              {v.policy.requireAllSeats ? "house policy: all seats, including an unaffiliated member." : `${v.general.majorityNeeded} needed, including a nonscientist.`}
              {!v.general.hasUnaffiliated && <Badge tone="warn">No unaffiliated member present</Badge>}
            </p>
            {!v.general.quorum && <p className="mt-2 text-sm text-red-800">{v.general.problems.join(" ")}</p>}
            <ul className="mt-3 space-y-1 text-sm">
              {v.attendance.map((a) => (
                <li key={a.id} className={a.leftAt ? "text-neutral-400 line-through" : ""}>
                  {name(a.memberId)} · {a.mode.replace("_", " ")}
                  {a.replacingMemberId && ` · alternate for ${name(a.replacingMemberId)}`}
                  {!a.hasMaterials && " · not counted (no materials)"}
                </li>
              ))}
            </ul>
            {me && !myAttendance && (
              <form action={join} className="mt-4 grid gap-3 text-sm md:grid-cols-3 md:items-end">
                <input type="hidden" name="meetingId" value={id} />
                <label className="block">
                  <span className="font-medium">How are you attending?</span>
                  <select name="mode" className={`mt-1 w-full ${input}`}>
                    <option value="video">Video</option>
                    <option value="phone">Phone</option>
                    <option value="in_person">In person</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="hasMaterials" value="yes" required /> I received and reviewed the materials
                </label>
                <PrimaryButton>I&apos;m present</PrimaryButton>
              </form>
            )}
            {myAttendance && (
              <form action={leave} className="mt-3">
                <input type="hidden" name="meetingId" value={id} />
                <button className="text-sm underline">I&apos;m leaving the meeting</button>
              </form>
            )}
          </Card>
        )}

        {v.items.map(({ item, submission, study }, idx) => {
          const per = v.perItem.find((p) => p.itemId === item.id)!;
          const canVote = live && item.status === "voting" && me && per.seats.votingMemberIds.includes(me.id);
          const myVote = me && per.votes.find((x) => x.memberId === me.id)?.vote;
          return (
            <Card key={item.id} title={`Item ${idx + 1}: ${study.irbNumber} ${study.title}`}>
              <div id={`item-${item.id}`} className="scroll-mt-20 space-y-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.status === "decided" ? "good" : item.status === "voting" ? "warn" : "neutral"}>{item.status}</Badge>
                  {live && (per.seats.quorum ? <Badge tone="good">Quorum for this item</Badge> : <Badge tone="bad">No quorum for this item</Badge>)}
                  <a className="underline" href={`/submissions/${submission.id}`}>Open the submission</a>
                </p>
                {live && !per.seats.quorum && <p className="text-red-800">{per.seats.problems.join(" ")}</p>}
                {item.status === "decided" && (
                  <p>{MOTIONS[item.motion!]}: {item.votesFor} for, {item.votesAgainst} against, {item.votesAbstain} abstaining, of {item.votingPresent} present.</p>
                )}

                {item.status === "voting" && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                    <p className="font-medium">Motion: {MOTIONS[item.motion!]}</p>
                    {item.explanation && <p className="mt-1">{item.explanation}</p>}
                    <p className="mt-1">{per.votes.length} of {per.seats.votingMemberIds.length} eligible members have voted.{myVote && ` Your vote: ${myVote}.`}</p>
                    {canVote && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {(["for", "against", "abstain"] as const).map((val) => (
                          <form key={val} action={vote}>
                            <input type="hidden" name="meetingId" value={id} />
                            <input type="hidden" name="itemId" value={item.id} />
                            <input type="hidden" name="vote" value={val} />
                            <button className="w-full rounded-md border border-neutral-400 bg-white px-3 py-3 font-medium capitalize text-neutral-900">{val}</button>
                          </form>
                        ))}
                      </div>
                    )}
                    {isChair && (
                      <form action={close} className="mt-3">
                        <input type="hidden" name="meetingId" value={id} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <button className="rounded-md bg-neutral-900 px-3 py-2 text-white">Close the vote</button>
                      </form>
                    )}
                  </div>
                )}

                {live && myAttendance && item.status !== "decided" && (
                  <form action={stepOut} className="flex flex-wrap gap-2">
                    <input type="hidden" name="meetingId" value={id} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <input name="reason" placeholder="Conflict on this item? Describe it" className={`flex-1 ${input}`} />
                    <button className="rounded-md border border-neutral-400 px-3 py-2">Step out for this item</button>
                  </form>
                )}

                {live && isChair && item.status === "pending" && (
                  <details className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                    <summary className="cursor-pointer font-medium">Put a motion to the vote</summary>
                    <form action={propose} className="mt-3 space-y-3">
                      <input type="hidden" name="meetingId" value={id} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <label className="block">
                        <span className="font-medium">Motion</span>
                        <select name="motion" required defaultValue="" className={`mt-1 w-full ${input}`}>
                          <option value="" disabled>Choose…</option>
                          {Object.entries(MOTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </label>
                      <p className="text-xs text-neutral-500">The board&apos;s determinations under 21 CFR 56.111 (needed for every motion except tabling):</p>
                      {APPROVAL_CRITERIA.map((c) => (
                        <fieldset key={c.id}>
                          <legend><span className="font-medium">{c.cfr}</span> {c.text}</legend>
                          <div className="mt-1 flex flex-wrap gap-4">
                            <label className="flex items-center gap-1"><input type="radio" name={`c:${c.id}`} value="met" /> Met</label>
                            <label className="flex items-center gap-1"><input type="radio" name={`c:${c.id}`} value="not_met" /> Not met</label>
                            {c.naAllowed && <label className="flex items-center gap-1"><input type="radio" name={`c:${c.id}`} value="na" /> Not applicable</label>}
                          </div>
                        </fieldset>
                      ))}
                      {submission.involvesChildren && (
                        <label className="block">
                          <span className="font-medium">Children: Subpart D category</span>
                          <select name="childrenCategory" className={`mt-1 w-full ${input}`}>
                            <option value="">Choose…</option>
                            <option value="21 CFR 50.51">50.51 no more than minimal risk</option>
                            <option value="21 CFR 50.52">50.52 more than minimal risk, direct benefit</option>
                            <option value="21 CFR 50.53">50.53 minor increase over minimal risk, no direct benefit</option>
                          </select>
                        </label>
                      )}
                      <label className="block"><span className="font-medium">Approval period in months (if approving)</span><input name="approvalMonths" type="number" min={1} max={12} className={`mt-1 w-32 ${input}`} /></label>
                      <label className="block"><span className="font-medium">Required changes, reasons for disapproval, or reason for tabling</span><textarea name="explanation" rows={3} className={`mt-1 w-full ${input}`} /></label>
                      <label className="block"><span className="font-medium">Controverted issues and how they were resolved</span><textarea name="controvertedIssues" rows={2} className={`mt-1 w-full ${input}`} /></label>
                      <PrimaryButton>Open voting</PrimaryButton>
                    </form>
                  </details>
                )}
              </div>
            </Card>
          );
        })}

        {live && isChair && (
          <Card title="Adjourn">
            <form action={end} className="space-y-3 text-sm">
              <input type="hidden" name="meetingId" value={id} />
              <p>Adjourning generates the minutes from this record. Undecided items go back in the queue.</p>
              <input name="password" type="password" required placeholder="Your password, to sign the minutes" className={`w-full ${input}`} />
              <PrimaryButton>Adjourn and sign the minutes</PrimaryButton>
            </form>
          </Card>
        )}

        {v.meeting.minutes && (
          <Card title="Minutes">
            <pre className="text-xs whitespace-pre-wrap">{v.meeting.minutes}</pre>
            <p className="mt-2 font-mono text-xs text-neutral-500">Signed by the chair · fingerprint {v.meeting.minutesHash?.slice(0, 16)} · <a className="underline" href={`/meetings/${id}/minutes.pdf`}>PDF</a></p>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
