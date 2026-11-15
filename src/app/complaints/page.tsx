import { redirect } from "next/navigation";
import { db } from "@/db";
import { isoToday } from "@/domain/roster";
import { requireUser } from "@/lib/auth/session";
import { FROM_ROLES, linkComplaintToStudy, listComplaints, respondToComplaint } from "@/lib/complaints";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, ErrorNote } from "@/components/ui";

const input = "w-full rounded border border-neutral-300 bg-transparent px-2 py-2 dark:border-neutral-700";

async function respond(formData: FormData) {
  "use server";
  const actor = await requireUser();
  try {
    await db.transaction((tx) => respondToComplaint(tx, actor, String(formData.get("id")), String(formData.get("response") ?? ""), formData.get("refer") === "yes"));
  } catch (e) {
    redirect(`/complaints?error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect("/complaints?ok=Response%20recorded.%20The%20person%20can%20read%20it%20with%20their%20reference.");
}

async function link(formData: FormData) {
  "use server";
  const actor = await requireUser();
  try {
    await db.transaction((tx) => linkComplaintToStudy(tx, actor, String(formData.get("id")), String(formData.get("irbNumber") ?? "")));
  } catch (e) {
    redirect(`/complaints?error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect("/complaints?ok=Linked.");
}

export default async function ComplaintsPage({ searchParams }: PageProps<"/complaints">) {
  const user = await requireUser();
  const { error, ok } = await searchParams;
  const rows = await listComplaints(db, user);
  const now = new Date(`${isoToday()}T00:00:00Z`);
  const canAnswer = user.roles.includes("chair") || user.roles.includes("administrator");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Complaints, questions and concerns</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">From the public form at <a className="underline" href="/concern">/concern</a>. Respond within 5 business days (SOP-11).</p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>}
      <div className="mt-6 grid gap-4">
        {rows.length === 0 && <p className="text-sm text-neutral-500">None received.</p>}
        {rows.map(({ complaint: c, irbNumber }) => {
          const ageDays = Math.floor((now.getTime() - c.receivedAt.getTime()) / 86_400_000);
          return (
            <Card key={c.id} title={`${c.reference} · ${FROM_ROLES[c.fromRole as keyof typeof FROM_ROLES] ?? c.fromRole}`}>
              <div id={c.reference} className="scroll-mt-20 space-y-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.status === "open" ? (ageDays > 7 ? "bad" : "warn") : "good"}>{c.status}</Badge>
                  <span>received {c.receivedAt.toISOString().slice(0, 10)}</span>
                  <span>{irbNumber ?? (c.studyReference ? `study given as "${c.studyReference}"` : "no study given")}</span>
                  {(c.contactName || c.contactDetail) && <span>contact: {[c.contactName, c.contactDetail].filter(Boolean).join(", ")}</span>}
                </p>
                <p className="whitespace-pre-wrap">{c.message}</p>
                {c.response && <p className="rounded-md bg-neutral-50 p-2 whitespace-pre-wrap dark:bg-neutral-900">Response: {c.response}</p>}
                {canAnswer && c.status === "open" && (
                  <>
                    {!c.studyId && (
                      <form action={link} className="flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={c.id} />
                        <input name="irbNumber" placeholder="IRB-2026-0001" className={`flex-1 ${input}`} />
                        <button className="rounded-md border border-neutral-400 px-3 py-2">Link to study</button>
                      </form>
                    )}
                    <form action={respond} className="space-y-2">
                      <input type="hidden" name="id" value={c.id} />
                      <textarea name="response" rows={3} required placeholder="Reply the person will see with their reference" className={input} />
                      <label className="flex items-center gap-2"><input type="checkbox" name="refer" value="yes" /> Suggests harm or noncompliance: also file a problem report on the study</label>
                      <button className="rounded-md bg-neutral-900 px-3 py-2 text-white">Send response</button>
                    </form>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
