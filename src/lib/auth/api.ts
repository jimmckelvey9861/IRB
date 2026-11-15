import "server-only";
import type { User } from "./service";
import { currentSession } from "./session";

/** For route handlers: the signed-in user, or null (the caller answers 401). */
export async function apiUser(): Promise<User | null> {
  const s = await currentSession();
  return s && s.session.mfaVerified ? s.user : null;
}
