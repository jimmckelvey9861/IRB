import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import type { User } from "@/lib/auth/service";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/submissions", label: "Submissions" },
  { href: "/reviews", label: "My reviews" },
  { href: "/roster", label: "Board roster" },
  { href: "/audit", label: "Audit trail" },
];

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6">
          <span className="font-semibold">IRB</span>
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-neutral-500">
              {user.fullName} · {user.roles.join(", ")}
            </span>
            <form action={signOut}>
              <button className="underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
    </div>
  );
}
