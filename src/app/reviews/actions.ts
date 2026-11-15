"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { APPROVAL_CRITERIA, type CriterionAnswer, type CriterionId, type Decision } from "@/domain/review";
import { requireUser } from "@/lib/auth/session";
import { completeReview, declareConflict } from "@/lib/submissions";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function submitConflict(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("assignmentId"));
  const hasConflict = formData.get("hasConflict") === "yes";
  try {
    await db.transaction((tx) => declareConflict(tx, actor, id, hasConflict, String(formData.get("details") ?? "")));
  } catch (e) {
    redirect(`/reviews/${id}?error=${encodeURIComponent(msg(e))}`);
  }
  if (hasConflict) redirect(`/reviews?ok=${encodeURIComponent("Thank you. You have been removed from this review and someone else was assigned.")}`);
  redirect(`/reviews/${id}`);
}

export async function submitReview(formData: FormData) {
  const actor = await requireUser();
  const id = String(formData.get("assignmentId"));
  const answers: Partial<Record<CriterionId, CriterionAnswer>> = {};
  for (const c of APPROVAL_CRITERIA) {
    const v = formData.get(`c:${c.id}`);
    if (v === "met" || v === "not_met" || v === "na") answers[c.id] = v;
  }
  const decision = (String(formData.get("decision") ?? "") || undefined) as Decision | undefined;
  const months = Number(formData.get("approvalMonths") ?? 0);
  let result;
  try {
    result = await db.transaction((tx) =>
      completeReview(tx, actor, id, {
        answers,
        notes: String(formData.get("notes") ?? ""),
        decision,
        explanation: String(formData.get("explanation") ?? ""),
        approvalMonths: months || undefined,
        confirmsExpeditedEligibility: formData.get("confirmsExpedited") === "yes",
        password: String(formData.get("password") ?? ""),
      }),
    );
  } catch (e) {
    redirect(`/reviews/${id}?error=${encodeURIComponent(msg(e))}`);
  }
  if (!result.ok) redirect(`/reviews/${id}?error=${encodeURIComponent(result.problems.join(" "))}`);
  redirect(`/reviews/${id}?ok=${encodeURIComponent("Review signed and recorded.")}`);
}
