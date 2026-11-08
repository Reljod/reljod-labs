import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { Icon } from "@/components/ui/icon";
import { profile } from "@/content/profile";
import { source, sourcePath } from "@/features/ledger/domain/source-paths";

/**
 * `aside` fills the right column: Ledger's chat on the home page, with Ledger
 * peeking up from the hero's bottom edge, so it keeps room below for him.
 */
export function Hero({ aside }: { aside?: ReactNode }) {
  return (
    <section
      id="top"
      aria-labelledby="hero-title"
      className="relative overflow-hidden bg-marble"
    >
      <div
        className={`mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-24 ${aside ? "pb-36 sm:pb-40 lg:pb-48" : ""}`}
      >
        <div>
          <p className="eyebrow mb-6 text-ink-muted">
            {profile.title} · {profile.focus}
          </p>
          <h1
            id="hero-title"
            className="font-mono text-5xl leading-none font-bold tracking-[-0.02em] uppercase sm:text-6xl lg:text-display"
            {...source(sourcePath.headline)}
          >
            {profile.headline}
          </h1>
          <p
            className="mt-8 max-w-xl text-xl leading-normal"
            {...source(sourcePath.intro)}
          >
            {profile.intro}
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <ButtonLink href="#contact">
              Book a call
              <Icon name="arrow" size={18} />
            </ButtonLink>
            <ButtonLink href="#projects" variant="secondary">
              See the work
            </ButtonLink>
          </div>
        </div>
        {aside}
      </div>
    </section>
  );
}
