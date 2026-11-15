import { signIn } from "./actions";
import { Field, PrimaryButton, ErrorNote } from "@/components/ui";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-neutral-500">IRB review system</p>
      {typeof error === "string" && <ErrorNote>{error}</ErrorNote>}
      <form action={signIn} className="mt-6 space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="username" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <PrimaryButton>Continue</PrimaryButton>
      </form>
    </main>
  );
}
