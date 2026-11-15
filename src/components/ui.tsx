import type { ComponentProps, ReactNode } from "react";

export function Field({ label, ...props }: { label: string } & ComponentProps<"input">) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <input
        {...props}
        className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
      />
    </label>
  );
}

export function Select({
  label,
  options,
  ...props
}: { label: string; options: { value: string; label: string }[] } & ComponentProps<"select">) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <select
        {...props}
        className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PrimaryButton({ children, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="submit"
      {...props}
      className="w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      {children}
    </p>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Badge({ tone, children }: { tone: "good" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  const tones = {
    good: "bg-green-100 text-green-900",
    warn: "bg-amber-100 text-amber-900",
    bad: "bg-red-100 text-red-900",
    neutral: "bg-neutral-100 text-neutral-800",
  };
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
