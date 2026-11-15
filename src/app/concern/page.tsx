import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { complaintByReference, FROM_ROLES, submitComplaint } from "@/lib/complaints";
import { IRB_NAME } from "@/lib/meetings";
import { PrimaryButton } from "@/components/ui";

export const metadata: Metadata = { title: "Contact the IRB" };

const input = "mt-1 w-full rounded border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

async function send(formData: FormData) {
  "use server";
  const get = (k: string) => String(formData.get(k) ?? "");
  let ref: string;
  try {
    const c = await db.transaction((tx) =>
      submitComplaint(tx, {
        fromRole: get("fromRole") as keyof typeof FROM_ROLES,
        studyReference: get("studyReference"),
        message: get("message"),
        contactName: get("contactName"),
        contactDetail: get("contactDetail"),
      }),
    );
    ref = c.reference;
  } catch (e) {
    redirect(`/concern?error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/concern?sent=${ref}`);
}

async function lookUp(formData: FormData) {
  "use server";
  redirect(`/concern?ref=${encodeURIComponent(String(formData.get("ref") ?? "").trim())}`);
}

/** Public page: no sign-in. The link and phone number go in every consent form (SOP-11). */
export default async function ConcernPage({ searchParams }: PageProps<"/concern">) {
  const { error, sent, ref } = await searchParams;
  const found = typeof ref === "string" && ref ? await complaintByReference(db, ref) : undefined;

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Contact the {IRB_NAME}</h1>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        The IRB is an independent board that protects people who take part in research. Use this form for a complaint, question or concern about a study. You do not need to give your name. Do not include medical details you would rather keep private.
      </p>
      {typeof error === "string" && <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {typeof sent === "string" ? (
        <div className="mt-6 rounded-md border border-green-300 bg-green-50 p-4 text-green-950">
          <p className="font-medium">Thank you. We received your message.</p>
          <p className="mt-2 text-sm">Your reference is <span className="font-mono text-base font-semibold">{sent}</span>. Keep it to check for our reply on this page. We respond within 5 business days. If someone is in danger, call 911 first.</p>
        </div>
      ) : (
        <form action={send} className="mt-6 space-y-4 text-sm">
          <label className="block font-medium">I am
            <select name="fromRole" className={input}>
              {Object.entries(FROM_ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="block font-medium">Which study? (the IRB number on your consent form, or the study name, if you know it)
            <input name="studyReference" className={input} placeholder="For example IRB-2026-0001" />
          </label>
          <label className="block font-medium">Your message
            <textarea name="message" rows={6} required className={input} />
          </label>
          <fieldset className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <legend className="px-1 font-medium">How to reach you (optional)</legend>
            <input name="contactName" className={input} placeholder="Name" />
            <input name="contactDetail" className={input} placeholder="Phone or email" />
          </fieldset>
          <PrimaryButton>Send to the IRB</PrimaryButton>
        </form>
      )}

      <section className="mt-10 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <h2 className="font-semibold">Check for a reply</h2>
        <form action={lookUp} className="mt-3 flex gap-2 text-sm">
          <input name="ref" defaultValue={typeof ref === "string" ? ref : ""} placeholder="Your reference, e.g. C-7KQ2MX" className="flex-1 rounded border border-neutral-300 px-3 py-2 dark:border-neutral-700" />
          <button className="rounded-md bg-neutral-900 px-4 py-2 text-white">Check</button>
        </form>
        {found === null && <p className="mt-3 text-sm text-red-800">No message has that reference.</p>}
        {found && (
          <div className="mt-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <p>Received {found.receivedAt.toISOString().slice(0, 10)} · {found.status === "open" ? "We are looking into it." : "Answered"}</p>
            {found.response && <p className="mt-2 whitespace-pre-wrap">{found.response}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
