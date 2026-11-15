import { requireUser } from "@/lib/auth/session";
import { EXPEDITED_CATEGORIES } from "@/domain/review";
import { AppShell } from "@/components/app-shell";
import { ErrorNote, Field, PrimaryButton, Select } from "@/components/ui";
import { createDraft } from "../actions";

const yesNo = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
];

export default async function NewSubmissionPage({ searchParams }: PageProps<"/submissions/new">) {
  const user = await requireUser();
  const { error } = await searchParams;
  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">New study</h1>
      <p className="mt-1 text-sm text-neutral-500">
        The system checks your consent form as soon as you save, so problems are fixed before reviewers see it.
      </p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      <form action={createDraft} className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Study title" name="title" required />
        </div>
        <Field label="Sponsor" name="sponsor" required />
        <Field label="Expertise needed (comma separated)" name="expertise" placeholder="e.g. oncology, pediatrics" />
        <label className="block text-sm md:col-span-2">
          <span className="font-medium">Plain-language summary (what happens to participants)</span>
          <textarea name="summary" required minLength={20} rows={4} className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="font-medium">Protocol text (optional in this version; file uploads come later)</span>
          <textarea name="protocolText" rows={4} className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
        </label>
        <label className="block text-sm md:col-span-2">
          <span className="font-medium">Consent form text</span>
          <textarea name="consentText" required rows={10} className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-xs dark:border-neutral-700" />
        </label>
        <Select label="Is the study no more than minimal risk?" name="minimalRisk" options={yesNo} />
        <Select
          label="If minimal risk: expedited category"
          name="expeditedCategory"
          options={[{ value: "", label: "None / not sure" }, ...EXPEDITED_CATEGORIES.map((c) => ({ value: String(c.id), label: `${c.id}. ${c.label}` }))]}
        />
        <Select label="Applicable clinical trial (must register on ClinicalTrials.gov)?" name="applicableClinicalTrial" options={[...yesNo].reverse()} />
        <Select label="Involves children?" name="involvesChildren" options={yesNo} />
        <Select label="Involves other vulnerable people (e.g. impaired consent capacity)?" name="involvesVulnerable" options={yesNo} />
        <div className="md:col-span-2">
          <PrimaryButton>Save and check</PrimaryButton>
        </div>
      </form>
    </AppShell>
  );
}
