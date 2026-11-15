"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import type { EventKind } from "@/domain/oversight";
import { requireUser } from "@/lib/auth/session";
import { markRead } from "@/lib/notify";
import { closeStudy, createFollowOnSubmission, determineEvent, fileEventReport, signRegulatoryReport } from "@/lib/oversight";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function back(studyId: string, key: "ok" | "error", text: string, anchor = ""): never {
  redirect(`/studies/${studyId}?${key}=${encodeURIComponent(text)}${anchor}`);
}

export async function startFollowOn(formData: FormData) {
  const actor = await requireUser();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => Math.max(0, Math.floor(Number(get(k)) || 0));
  const studyId = get("studyId");
  const kind = get("kind") === "continuing" ? "continuing" : "amendment";
  const category = Number(get("expeditedCategory"));
  let id: string;
  try {
    const sub = await db.transaction((tx) =>
      createFollowOnSubmission(tx, actor, studyId, {
        kind,
        summary: get("summary"),
        consentText: String(formData.get("consentText") ?? ""),
        minimalRisk: get("minimalRisk") === "yes",
        expeditedCategory: category >= 1 && category <= 9 ? category : null,
        minorChange: get("minorChange") === "yes",
        progressReport:
          kind === "continuing"
            ? {
                enrolledTotal: num("enrolledTotal"),
                enrolledSinceLastReview: num("enrolledSinceLastReview"),
                withdrawn: num("withdrawn"),
                enrollmentOpen: get("enrollmentOpen") === "yes",
                problemsSummary: get("problemsSummary"),
              }
            : null,
      }),
    );
    id = sub.id;
  } catch (e) {
    back(studyId, "error", msg(e));
  }
  redirect(`/submissions/${id}?ok=${encodeURIComponent("Draft saved. Check it, then send it to the IRB.")}`);
}

export async function reportEvent(formData: FormData) {
  const actor = await requireUser();
  const studyId = String(formData.get("studyId"));
  try {
    await db.transaction((tx) =>
      fileEventReport(tx, actor, studyId, {
        kind: String(formData.get("kind")) as EventKind,
        occurredOn: String(formData.get("occurredOn")),
        description: String(formData.get("description") ?? ""),
      }),
    );
  } catch (e) {
    back(studyId, "error", msg(e));
  }
  back(studyId, "ok", "Report received. The IRB chair has been notified.");
}

export async function determine(formData: FormData) {
  const actor = await requireUser();
  const studyId = String(formData.get("studyId"));
  const eventId = String(formData.get("eventId"));
  let result;
  try {
    result = await db.transaction((tx) =>
      determineEvent(
        tx,
        actor,
        eventId,
        {
          isUnanticipatedProblem: formData.get("isUnanticipatedProblem") === "yes",
          noncompliance: String(formData.get("noncompliance")) as "none" | "minor" | "serious" | "continuing",
          action: String(formData.get("action")) as "none" | "require_modifications" | "suspend" | "terminate",
          rationale: String(formData.get("rationale") ?? ""),
        },
        String(formData.get("password") ?? ""),
      ),
    );
  } catch (e) {
    back(studyId, "error", msg(e), `#event-${eventId}`);
  }
  if (!result.ok) back(studyId, "error", result.problems.join(" "), `#event-${eventId}`);
  back(studyId, "ok", result.reports.length ? `Determination signed. ${result.reports.length} report(s) drafted for the organizational official.` : "Determination signed. No regulatory reports are required.", `#event-${eventId}`);
}

export async function signReport(formData: FormData) {
  const actor = await requireUser();
  const studyId = String(formData.get("studyId"));
  let result;
  try {
    result = await db.transaction((tx) => signRegulatoryReport(tx, actor, String(formData.get("reportId")), String(formData.get("password") ?? "")));
  } catch (e) {
    back(studyId, "error", msg(e));
  }
  if (!result.ok) back(studyId, "error", result.problem);
  back(studyId, "ok", "Report signed. Send it to the listed recipients.");
}

export async function dismissNotice(formData: FormData) {
  const actor = await requireUser();
  await markRead(db, actor.id, String(formData.get("id")));
  revalidatePath("/");
}

export async function close(formData: FormData) {
  const actor = await requireUser();
  const studyId = String(formData.get("studyId"));
  let until = "";
  try {
    until = await db.transaction((tx) => closeStudy(tx, actor, studyId, String(formData.get("finalReport") ?? "")));
  } catch (e) {
    back(studyId, "error", msg(e));
  }
  back(studyId, "ok", `Study closed. Its records will be kept until at least ${until}.`);
}
