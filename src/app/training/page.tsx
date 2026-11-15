import { redirect } from "next/navigation";
import { db } from "@/db";
import { COURSES, type CourseStatus } from "@/domain/training";
import { isoToday } from "@/domain/roster";
import { requireUser } from "@/lib/auth/session";
import { recordTraining, trainingFor, trainingMatrix } from "@/lib/training";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, ErrorNote, PrimaryButton } from "@/components/ui";

const input = "mt-1 w-full rounded border border-neutral-300 bg-transparent px-2 py-2 dark:border-neutral-700";

async function record(formData: FormData) {
  "use server";
  const actor = await requireUser();
  try {
    await db.transaction((tx) =>
      recordTraining(tx, actor, {
        userId: String(formData.get("userId") || actor.id),
        course: String(formData.get("course")),
        completedOn: String(formData.get("completedOn")),
        evidence: String(formData.get("evidence") ?? ""),
      }),
    );
  } catch (e) {
    redirect(`/training?error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect("/training?ok=Training%20recorded.");
}

function StatusBadge({ s }: { s: CourseStatus }) {
  if (s.state === "missing") return <Badge tone="bad">missing</Badge>;
  if (s.state === "expired") return <Badge tone="bad">expired {s.expiresOn}</Badge>;
  if (s.daysLeft !== null && s.daysLeft <= 60) return <Badge tone="warn">expires {s.expiresOn}</Badge>;
  return <Badge tone="good">current{s.expiresOn ? ` to ${s.expiresOn}` : ""}</Badge>;
}

export default async function TrainingPage({ searchParams }: PageProps<"/training">) {
  const user = await requireUser();
  const { error, ok } = await searchParams;
  const mine = await trainingFor(db, user);
  const isAdmin = user.roles.includes("administrator");
  const matrix = isAdmin || user.roles.includes("official") || user.roles.includes("chair") ? await trainingMatrix(db) : null;

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Training</h1>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card title="My training">
          <ul className="space-y-2 text-sm">
            {mine.status.map((s) => (
              <li key={s.course.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge s={s} /> {s.course.label}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Record a completed course">
          <form action={record} className="space-y-3 text-sm">
            {matrix && isAdmin && (
              <label className="block">Person
                <select name="userId" className={input} defaultValue={user.id}>
                  {matrix.map((r) => <option key={r.user.id} value={r.user.id}>{r.user.fullName}</option>)}
                </select>
              </label>
            )}
            <label className="block">Course
              <select name="course" className={input}>
                {COURSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="block">Completed on<input name="completedOn" type="date" required max={isoToday()} className={input} /></label>
            <label className="block">Evidence<input name="evidence" required placeholder="Certificate number and provider" className={input} /></label>
            <PrimaryButton>Record</PrimaryButton>
          </form>
        </Card>
      </div>
      {matrix && (
        <div className="mt-4">
          <Card title="Everyone's training">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-neutral-500"><tr><th className="py-1 pr-3">Person</th>{COURSES.map((c) => <th key={c.id} className="pr-3">{c.id}</th>)}</tr></thead>
                <tbody>
                  {matrix.map((r) => (
                    <tr key={r.user.id} className="border-t border-neutral-100 dark:border-neutral-900">
                      <td className="py-1 pr-3">{r.user.fullName}</td>
                      {COURSES.map((c) => {
                        const s = r.status.find((x) => x.course.id === c.id);
                        return <td key={c.id} className="pr-3">{s ? <StatusBadge s={s} /> : <span className="text-neutral-400">n/a</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
