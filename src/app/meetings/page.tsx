import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { listMeetings, waitingForMeeting } from "@/lib/meetings";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, ErrorNote, Field, PrimaryButton } from "@/components/ui";
import { scheduleNow } from "./actions";

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export default async function MeetingsPage({ searchParams }: PageProps<"/meetings">) {
  const user = await requireUser();
  const { error, ok } = await searchParams;
  const [list, waiting] = await Promise.all([listMeetings(db), waitingForMeeting(db)]);
  const canSchedule = user.roles.some((r) => r === "chair" || r === "administrator");
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Board meetings</h1>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}
      <div className="mt-6 grid gap-4">
        <Card title={`Waiting for the full board (${waiting.length})`}>
          {waiting.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing is waiting.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {waiting.map((w) => (
                <li key={w.submission.id}>
                  <span className="font-mono text-xs text-neutral-500">{w.study.irbNumber}</span> {w.study.title}
                </li>
              ))}
            </ul>
          )}
          {canSchedule && waiting.length > 0 && (
            <form action={scheduleNow} className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Video meeting link (HIPAA-eligible service)" name="videoLink" placeholder="https://..." />
              <div><PrimaryButton>Book the earliest valid meeting</PrimaryButton></div>
            </form>
          )}
          <p className="mt-3 text-xs text-neutral-500">
            The system books the first time when a majority of members, including a nonscientist, have said they are free, using alternates where needed. Members with a declared conflict are left out of the count.
          </p>
        </Card>
        <Card title="Meetings">
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {list.map((m) => (
              <li key={m.id} className="py-2">
                <Link href={`/meetings/${m.id}`} className="flex flex-wrap items-center gap-3">
                  <Badge tone={m.status === "in_progress" ? "warn" : m.status === "adjourned" ? "good" : "neutral"}>{m.status.replace("_", " ")}</Badge>
                  <span>{when(m.scheduledStart)}</span>
                </Link>
              </li>
            ))}
            {list.length === 0 && <li className="py-2 text-neutral-500">No meetings yet.</li>}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
