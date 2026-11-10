"use client";

import { AnimatePresence, motion } from "motion/react";
import { Cat, type CatPose } from "@/features/ledger/components/cat";

const SIZE = 120;
const HEIGHT = Math.round((SIZE * 250) / 240);

export type CatCue = {
  /** What he is doing. */
  pose: CatPose;
  /** A few words in a speech bubble, or none. */
  line?: string;
};

/**
 * Ledger, at his post in the bottom right. He lives in his own fixed layer
 * above every panel, drawer and dialog, so nothing on the page can move, clip
 * or cover him. He stays put: what changes is his pose and what he says.
 */
export function CatLayer({ cue, floor }: { cue: CatCue; floor: number }) {
  return (
    <div
      className="pointer-events-none fixed right-3 z-[90]"
      style={{
        bottom: floor - 4,
        width: SIZE,
        height: HEIGHT,
        transition: "bottom 220ms ease",
      }}
      aria-hidden="true"
    >
      <AnimatePresence>
        {cue.line ? (
          <motion.p
            key={cue.line}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute right-1 bottom-full mb-0.5 w-max max-w-56 rounded-sm border-2 border-ink bg-paper px-2.5 py-1.5 text-center font-mono text-[11px] leading-tight font-bold tracking-[0.04em] uppercase shadow-hard-sm"
          >
            {cue.line}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <Cat pose={cue.pose} size={SIZE} />
    </div>
  );
}
