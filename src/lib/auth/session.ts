import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { ABSOLUTE_TIMEOUT_MS, getSessionByToken, type User } from "./service";

export const SESSION_COOKIE = "irb_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ABSOLUTE_TIMEOUT_MS / 1000,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Session that may still be waiting for its authenticator code. */
export async function currentSession() {
  const token = await readSessionToken();
  if (!token) return null;
  return getSessionByToken(db, token);
}

/** A fully signed-in user (password + authenticator), or a redirect to sign in. */
export async function requireUser(): Promise<User> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!s.session.mfaVerified) redirect("/login/verify");
  return s.user;
}
