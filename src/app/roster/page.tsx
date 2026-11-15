import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { boardStatus } from "@/lib/members";
import { AppShell } from "@/components/app-shell";
import { Badge, Card, ErrorNote, Field, PrimaryButton, Select } from "@/components/ui";
import { addMember, appoint, toggleExperienced } from "./actions";

export default async function RosterPage({ searchParams }: PageProps<"/roster">) {
  const user = await requireUser();
  const { error, ok } = await searchParams;
  const { roster, report } = await boardStatus(db);
  const primaries = roster.filter((m) => m.membershipType === "primary");
  const nameOf = (id: string) => roster.find((m) => m.id === id)?.name ?? "unknown";
  const isAdmin = user.roles.includes("administrator");
  const isOfficial = user.roles.includes("official");
  const isChair = user.roles.includes("chair");

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Board roster</h1>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {typeof ok === "string" && (
        <p className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{ok}</p>
      )}

      <div className="mt-6">
        <Card title="Composition check (21 CFR 56.107)">
          <p className="flex items-center gap-2 text-sm">
            {report.canOperate ? <Badge tone="good">Board may review</Badge> : <Badge tone="bad">Board may not review yet</Badge>}
            {report.activePrimaryCount} appointed primary members
          </p>
          {report.issues.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {report.issues.map((i) => (
                <li key={i.code + (i.memberId ?? "")} className="flex gap-2">
                  <Badge tone={i.severity === "blocking" ? "bad" : "warn"}>{i.severity}</Badge>
                  <span>
                    {i.message} <span className="text-neutral-500">({i.rule})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Seat</th>
              <th className="py-2 pr-4">Primary concern</th>
              <th className="py-2 pr-4">Affiliated</th>
              <th className="py-2 pr-4">Profession</th>
              <th className="py-2 pr-4">Training</th>
              <th className="py-2 pr-4" title="Designated by the chair to do expedited reviews (21 CFR 56.110(b))">Expedited reviewer</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((m) => (
              <tr key={m.id} className="border-b border-neutral-100 align-top dark:border-neutral-900">
                <td className="py-2 pr-4">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-neutral-500">{m.degrees}</div>
                </td>
                <td className="py-2 pr-4">
                  {m.membershipType === "primary" ? "Primary" : `Alternate for ${(m.alternateFor ?? []).map(nameOf).join(", ") || "nobody"}`}
                </td>
                <td className="py-2 pr-4">{m.primaryConcern === "scientific" ? "Scientific" : "Nonscientific"}</td>
                <td className="py-2 pr-4">{m.affiliated ? "Yes" : "No"}</td>
                <td className="py-2 pr-4">{m.profession}</td>
                <td className="py-2 pr-4">{m.trainingCompletedOn ?? <Badge tone="warn">none</Badge>}</td>
                <td className="py-2 pr-4">
                  {isChair ? (
                    <form action={toggleExperienced}>
                      <input type="hidden" name="memberId" value={m.id} />
                      <input type="hidden" name="value" value={m.experiencedReviewer ? "no" : "yes"} />
                      <button className="underline">{m.experiencedReviewer ? "Yes (remove)" : "No (designate)"}</button>
                    </form>
                  ) : m.experiencedReviewer ? (
                    "Yes"
                  ) : (
                    "No"
                  )}
                </td>
                <td className="py-2">
                  {m.status === "active" && <Badge tone="good">Appointed</Badge>}
                  {m.status === "inactive" && <Badge tone="neutral">Inactive</Badge>}
                  {m.status === "pending_appointment" &&
                    (isOfficial ? (
                      <form action={appoint} className="flex items-end gap-2">
                        <input type="hidden" name="memberId" value={m.id} />
                        <input
                          name="password"
                          type="password"
                          required
                          placeholder="Your password to sign"
                          aria-label={`Password to sign appointment of ${m.name}`}
                          className="w-40 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
                        />
                        <button className="rounded bg-blue-700 px-2 py-1 text-xs text-white">Sign appointment</button>
                      </form>
                    ) : (
                      <Badge tone="warn">Awaiting official</Badge>
                    ))}
                </td>
              </tr>
            ))}
            {roster.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-neutral-500">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="mt-8">
          <Card title="Add a member">
            <form action={addMember} className="grid gap-4 md:grid-cols-2">
              <Field label="Full name" name="fullName" required />
              <Field label="Email" name="email" type="email" required />
              <Field label="Temporary password (12+ characters)" name="temporaryPassword" type="password" minLength={12} required />
              <Field label="Profession" name="profession" placeholder="e.g. physician, attorney, pharmacist" required />
              <Field label="Degrees" name="degrees" placeholder="e.g. MD, PharmD" />
              <Field label="Expertise (comma separated)" name="expertise" placeholder="e.g. oncology, pediatrics" />
              <Select
                label="Seat"
                name="membershipType"
                options={[
                  { value: "primary", label: "Primary member" },
                  { value: "alternate", label: "Alternate" },
                ]}
              />
              <Select
                label="Primary concern"
                name="primaryConcern"
                options={[
                  { value: "scientific", label: "Scientific" },
                  { value: "nonscientific", label: "Nonscientific" },
                ]}
              />
              <Select
                label="Affiliated with the IRB's organization (or family of someone who is)?"
                name="affiliated"
                options={[
                  { value: "yes", label: "Yes, affiliated" },
                  { value: "no", label: "No, unaffiliated" },
                ]}
              />
              <Field label="Gender (optional, used only for the diversity check)" name="gender" />
              <Field label="Human-subjects training completed on" name="trainingCompletedOn" type="date" />
              <Field label="Term ends on" name="termEndsOn" type="date" />
              {primaries.length > 0 && (
                <fieldset className="text-sm md:col-span-2">
                  <legend className="font-medium">If alternate: primary members they may replace</legend>
                  <div className="mt-2 flex flex-wrap gap-4">
                    {primaries.map((p) => (
                      <label key={p.id} className="flex items-center gap-2">
                        <input type="checkbox" name="alternateFor" value={p.id} />
                        {p.name} ({p.primaryConcern})
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="md:col-span-2">
                <PrimaryButton>Add member</PrimaryButton>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
