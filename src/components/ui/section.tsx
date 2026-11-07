import type { ReactNode } from "react";

const grounds = {
  marble: "bg-marble",
  paper: "bg-paper",
  limestone: "bg-limestone",
} as const;

type SectionProps = {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
  ground?: keyof typeof grounds;
  children: ReactNode;
};

/** A full-bleed section on one of the three stone grounds, split from its neighbours by a 2px ink rule. */
export function Section({
  id,
  eyebrow,
  title,
  intro,
  ground = "marble",
  children,
}: SectionProps) {
  const headingId = `${id}-title`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`border-ink border-t-2 ${grounds[ground]}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <header className="mb-12 max-w-3xl">
          <p className="eyebrow mb-3 text-ink-muted">{eyebrow}</p>
          <h2
            id={headingId}
            className="font-mono text-3xl leading-[1.15] font-bold uppercase sm:text-[2rem]"
          >
            {title}
          </h2>
          {intro ? (
            <p className="mt-4 text-lg text-ink-muted">{intro}</p>
          ) : null}
        </header>
        {children}
      </div>
    </section>
  );
}
