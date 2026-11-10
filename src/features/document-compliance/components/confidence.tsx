"use client";

import { motion } from "motion/react";
import { formatPercent } from "../metrics";

/** Below this, a reading's confidence is shown as a warning. */
export const LOW_CONFIDENCE = 0.7;

export function ConfidenceBar({ value }: { value: number }) {
  const low = value < LOW_CONFIDENCE;
  return (
    <span
      role="img"
      data-testid="confidence"
      data-confidence={value}
      aria-label={`Confidence ${formatPercent(value)}`}
      className="mt-1 flex items-center gap-2"
    >
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-limestone">
        <motion.span
          className={`block h-full ${low ? "bg-brass" : "bg-federal-blue"}`}
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </span>
      <span
        className={`w-9 text-right font-mono text-[10px] font-bold ${low ? "text-oak" : "text-ink-muted"}`}
      >
        {formatPercent(value)}
      </span>
    </span>
  );
}
