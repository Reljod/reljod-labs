"use client";

import { ScrollRule } from "@/components/motion/scroll-rule";
import { catalog, sceneNumber } from "@/content/landing";
import { Catalog } from "./catalog/catalog";

/** After the tour: every demo in one catalog, to search, sort and play at your own pace. */
export function Everything() {
  return (
    <section
      id="everything"
      aria-labelledby="everything-title"
      className="slide-over relative border-ink border-t-2 bg-marble"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <Catalog
          heading={
            <header className="relative max-w-3xl">
              <p className="eyebrow mb-3 text-ink-muted">
                {sceneNumber("everything")} · The catalog
              </p>
              <h2
                id="everything-title"
                className="font-mono text-3xl leading-[1.1] font-bold uppercase sm:text-5xl"
              >
                {catalog.title}
              </h2>
              <p className="relative mt-5 text-lg text-ink-muted">
                {catalog.intro}
                <ScrollRule axis="x" className="-bottom-4 left-0 h-1 w-28" />
              </p>
            </header>
          }
        />
      </div>
    </section>
  );
}
