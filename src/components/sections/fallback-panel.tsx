import type { ReactNode } from "react";

/**
 * The box a fallback page shows: 404, a segment that failed, the root layout
 * that failed. No hooks, so a Server Component (`not-found.tsx`) and a Client
 * error boundary (`error.tsx`, `global-error.tsx`) can both render it.
 */
export function FallbackPanel({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl items-center px-4 py-16">
      <section className="outline-box w-full rounded-sm bg-paper p-6 shadow-hard-lg sm:p-10">
        <p className="eyebrow text-ink-muted">{eyebrow}</p>
        <h1 className="mt-3 font-mono text-2xl font-bold sm:text-3xl">
          {title}
        </h1>
        <div className="mt-4 text-ink-muted">{children}</div>
        <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
      </section>
    </main>
  );
}

export const fallbackActionClass =
  "outline-box press inline-flex items-center rounded-sm bg-paper px-4 py-2 font-mono text-sm font-bold";

export const fallbackPrimaryActionClass =
  "outline-box press inline-flex items-center rounded-sm bg-ink px-4 py-2 font-mono text-sm font-bold text-marble";
