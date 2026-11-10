import Link from "next/link";
import type { ReactNode } from "react";

/** The frame every Access page shares: a way back, a title, one card. */
export function AccessShell({
  eyebrow,
  title,
  children,
  wide = false,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main
      className={`mx-auto flex min-h-dvh flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14 ${wide ? "max-w-4xl" : "max-w-xl"}`}
    >
      <header className="flex flex-col gap-3">
        <Link href="/" className="eyebrow text-federal-blue underline">
          ← Reljod Labs
        </Link>
        <p className="eyebrow text-ink-muted">{eyebrow}</p>
        <h1 className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2.5rem]">
          {title}
        </h1>
      </header>
      {children}
    </main>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <section className="outline-box flex flex-col gap-5 bg-paper p-6 shadow-hard-lg">
      {children}
    </section>
  );
}

export const Waiting = () => (
  <p className="eyebrow text-ink-muted">Checking the door…</p>
);
