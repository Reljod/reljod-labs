"use client";

import { motion } from "motion/react";
import type { Ref } from "react";
import { BlockView } from "./block-view";
import type { PlacedBlock } from "./placed-block";

type StackProps = {
  question: string;
  items: PlacedBlock[];
  /** Ledger is still pushing pieces up: keep a place open for the next. */
  building: boolean;
  stackRef: Ref<HTMLElement>;
  slotRef: Ref<HTMLLIElement>;
};

/* Papers on a pile never sit square. */
const TILT = [-2.5, 1.5, -1, 2.5, -2, 1];

/** Where Ledger stacks Content blocks above the page, in answer order, before writing them up. */
export function Stack({
  question,
  items,
  building,
  stackRef,
  slotRef,
}: StackProps) {
  return (
    <section
      ref={stackRef}
      aria-label="Ledger's stack"
      data-testid="stack"
      className="border-ink border-b-2 bg-[repeating-linear-gradient(0deg,transparent_0_23px,rgb(20_33_61/0.06)_23px_24px)] bg-limestone"
    >
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="eyebrow mb-5 text-ink-muted">{question}</p>
        <ol className="flex flex-wrap items-start gap-5">
          {items.map((item, index) => (
            <motion.li
              key={item.id}
              layoutId={item.id}
              data-testid="stack-block"
              data-source={item.source}
              className="relative w-full shadow-hard-md sm:w-68"
              style={{ rotate: TILT[index % TILT.length] }}
            >
              <BlockView block={item.block} size="compact" />
              <span
                aria-hidden="true"
                className="ldg-stamp-mark eyebrow absolute -top-3 -right-2 rounded-sm border-2 border-ink bg-brass px-1.5 font-bold"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
            </motion.li>
          ))}
          {building ? (
            <li
              ref={slotRef}
              data-testid="stack-slot"
              className="flex h-24 w-full items-center justify-center rounded-sm border-2 border-stone border-dashed sm:w-68"
            >
              <span className="sr-only">The next piece goes here</span>
            </li>
          ) : null}
        </ol>
      </div>
    </section>
  );
}
