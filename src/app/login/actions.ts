"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { checkCredentials, completeMfa, createSession, endSession } from "@/lib/auth/service";
import { SESSION_COOKIE, currentSession, readSessionToken, setSessionCookie } from "@/lib/auth/session";

const MESSAGES = {
  invalid: "That email and password do not match.",
  locked: "This account is locked after too many failed attempts. Ask an administrator to unlock it.",
  disabled: "This account has been disabled.",
} as const;

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await db.transaction((tx) => checkCredentials(tx, email, password));
  if (!result.ok) redirect(`/login?error=${encodeURIComponent(MESSAGES[result.reason])}`);
  const { token } = await createSession(db, result.user.id);
  await setSessionCookie(token);
  redirect("/login/verify");
}

export async function verifyCode(formData: FormData) {
  const s = await currentSession();
  if (!s) redirect("/login");
  const ok = await db.transaction((tx) => completeMfa(tx, s.session, s.user, String(formData.get("code") ?? "")));
  if (!ok) redirect(`/login/verify?error=${encodeURIComponent("That code did not match. Try the newest code.")}`);
  redirect("/");
}

export async function signOut() {
  const token = await readSessionToken();
  if (token) await endSession(db, token);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
