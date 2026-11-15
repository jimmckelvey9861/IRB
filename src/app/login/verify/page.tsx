import { redirect } from "next/navigation";
import { db } from "@/db";
import { beginTotpEnrollment } from "@/lib/auth/service";
import { currentSession } from "@/lib/auth/session";
import { otpauthUri } from "@/lib/auth/totp";
import { ErrorNote, Field, PrimaryButton } from "@/components/ui";
import { verifyCode } from "../actions";

export default async function VerifyPage({ searchParams }: PageProps<"/login/verify">) {
  const { error } = await searchParams;
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.session.mfaVerified) redirect("/");
  const enrolling = !s.user.totpSecret;
  const secret = enrolling ? await beginTotpEnrollment(db, s.session) : null;

  return (
    <main className="mx-auto mt-24 w-full max-w-md px-6">
      <h1 className="text-2xl font-semibold">{enrolling ? "Set up your authenticator" : "Enter your code"}</h1>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      {enrolling && secret && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            Federal electronic-records rules require two separate proofs of identity. Add this account to an
            authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), using this setup key:
          </p>
          <p className="rounded bg-neutral-100 p-3 font-mono text-base tracking-wider break-all dark:bg-neutral-800">
            {secret.match(/.{1,4}/g)?.join(" ")}
          </p>
          <p className="text-xs break-all text-neutral-500">{otpauthUri(secret, s.user.email)}</p>
        </div>
      )}
      <form action={verifyCode} className="mt-6 space-y-4">
        <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        <PrimaryButton>Verify</PrimaryButton>
      </form>
    </main>
  );
}
