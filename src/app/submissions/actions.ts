"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { CONSENT_ELEMENTS } from "@/domain/consent";
import { requireUser } from "@/lib/auth/session";
import { createStudyDraft, saveConsentResolutions, submitForReview } from "@/lib/submissions";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function createDraft(formData: FormData) {
  const actor = await requireUser();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  let id: string;
  try {
    const category = Number(get("expeditedCategory"));
    const { submission } = await db.transaction((tx) =>
      createStudyDraft(tx, actor, {
        title: get("title"),
        sponsor: get("sponsor"),
        expertise: get("expertise").split(",").map((s) => s.trim()).filter(Boolean),
        summary: get("summary"),
        protocolText: get("protocolText"),
        consentText: String(formData.get("consentText") ?? ""),
        minimalRisk: get("minimalRisk") === "yes",
        expeditedCategory: category >= 1 && category <= 9 ? category : null,
        applicableClinicalTrial: get("applicableClinicalTrial") === "yes",
        involvesChildren: get("involvesChildren") === "yes",
        involvesVulnerable: get("involvesVulnerable") === "yes",
      }),
    );
    id = submission.id;
  } catch (e) {
    redirect(`/submissions/new?error=${encodeURIComponent(msg(e))}`);
  }
  redirect(`/submissions/${id}`);
}

export async function resolveAndSubmit(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("submissionId"));
  const resolutions = CONSENT_ELEMENTS.map((el) => ({
    elementId: el.id,
    location: String(formData.get(`loc:${el.id}`) ?? "").trim() || undefined,
    notApplicableBecause: String(formData.get(`na:${el.id}`) ?? "").trim() || undefined,
  }));
  let result;
  try {
    result = await db.transaction(async (tx) => {
      await saveConsentResolutions(tx, actor, id, resolutions);
      return submitForReview(tx, actor, id);
    });
  } catch (e) {
    redirect(`/submissions/${id}?error=${encodeURIComponent(msg(e))}`);
  }
  if (!result.ok) {
    redirect(`/submissions/${id}?error=${encodeURIComponent(`Still missing: ${result.missing.join("; ")}`)}`);
  }
  redirect(`/submissions/${id}?ok=${encodeURIComponent("Sent to the IRB. Reviewers have been assigned.")}`);
}
