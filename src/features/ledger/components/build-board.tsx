"use client";

import { motion } from "motion/react";
import type { Ref } from "react";
import { BlockView } from "./block-view";
import type { PlacedBlock } from "./placed-block";

type BuildBoardProps = {
  placed: PlacedBlock[];
  /** Blocks on the board slide into the answer page and leave it empty. */
  reformed: boolean;
  building: boolean;
  slotRef: Ref<HTMLDivElement>;
};

/** Where Ledger places each Content block, in answer order, before Reform. */
export function BuildBoard({
  placed,
  reformed,
  building,
  slotRef,
}: BuildBoardProps) {
  const shown = reformed ? [] : placed;
  return (
    <section
      aria-label="Build board"
      data-testid="build-board"
      className="flex min-h-0 flex-col"
    >
      <div className="flex items-center justify-between gap-3 border-ink border-b-2 bg-morning-haze px-4 py-3">
        <p className="eyebrow font-bold">Build board</p>
        <p className="eyebrow text-ink-muted" data-testid="board-count">
          {shown.length} placed
        </p>
      </div>
      <ol className="flex min-h-0 flex-1 gap-3 overflow-auto bg-[repeating-linear-gradient(0deg,transparent_0_23px,rgb(20_33_61/0.06)_23px_24px)] p-3 max-lg:flex-row lg:flex-col">
        {shown.map((item, index) => (
          <motion.li
            key={item.id}
            layoutId={item.id}
            data-testid="board-block"
            data-source={item.source}
            className="relative shrink-0 max-lg:w-56"
          >
            {item.join ? (
              <p className="mb-1 truncate text-ink-muted text-xs italic">
                {item.join}…
              </p>
            ) : null}
            <BlockView block={item.block} size="compact" />
            <span
              aria-hidden="true"
              className="ldg-stamp-mark eyebrow absolute -top-2 -right-1 rounded-sm border-2 border-ink bg-brass px-1.5 font-bold"
            >
              Filed {String(index + 1).padStart(2, "0")}
            </span>
          </motion.li>
        ))}
        {building ? (
          <li className="shrink-0 max-lg:w-56">
            <div
              ref={slotRef}
              data-testid="board-slot"
              className="flex h-20 items-center justify-center rounded-sm border-2 border-stone border-dashed text-sm text-ink-muted"
            >
              Next piece goes here
            </div>
          </li>
        ) : null}
        {!building && shown.length === 0 ? (
          <li className="p-2 text-sm text-ink-muted">
            {reformed
              ? "Everything's filed into the answer."
              : "Ask a question and Ledger will fill this board."}
          </li>
        ) : null}
      </ol>
    </section>
  );
}
