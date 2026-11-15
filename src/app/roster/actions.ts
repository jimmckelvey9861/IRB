"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { PermissionError, appointMember, createMember } from "@/lib/members";

function back(params: Record<string, string>): never {
  redirect(`/roster?${new URLSearchParams(params).toString()}`);
}

export async function addMember(formData: FormData) {
  const actor = await requireUser();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  try {
    await db.transaction((tx) =>
      createMember(tx, actor, {
        fullName: get("fullName"),
        email: get("email"),
        temporaryPassword: get("temporaryPassword"),
        membershipType: get("membershipType") === "alternate" ? "alternate" : "primary",
        primaryConcern: get("primaryConcern") === "nonscientific" ? "nonscientific" : "scientific",
        affiliated: get("affiliated") === "yes",
        profession: get("profession"),
        degrees: get("degrees"),
        gender: get("gender") || undefined,
        expertise: get("expertise")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        trainingCompletedOn: get("trainingCompletedOn") || undefined,
        termEndsOn: get("termEndsOn") || undefined,
        alternateFor: formData.getAll("alternateFor").map(String).filter(Boolean),
      }),
    );
  } catch (e) {
    back({ error: e instanceof PermissionError ? e.message : `Could not add member: ${(e as Error).message}` });
  }
  revalidatePath("/roster");
  back({ ok: "Member added. They count toward the board once the official signs their appointment." });
}

export async function appoint(formData: FormData) {
  const actor = await requireUser();
  const memberId = String(formData.get("memberId") ?? "");
  const password = String(formData.get("password") ?? "");
  let result;
  try {
    result = await db.transaction((tx) => appointMember(tx, actor, memberId, password));
  } catch (e) {
    back({ error: (e as Error).message });
  }
  if (!result.ok) {
    back({ error: result.reason === "locked" ? "Your account is now locked after repeated failures." : "Password did not match; nothing was signed." });
  }
  revalidatePath("/roster");
  back({ ok: "Appointment signed." });
}
