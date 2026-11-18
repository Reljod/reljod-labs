"use client";

import {
  type MotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "motion/react";
import { useEffect, useRef } from "react";
import { useCopyMotion } from "./copy-motion";
import { splitFigure } from "./scroll-math";

/**
 * A figure ("7 yrs", "95–97%") whose first number counts up with scroll. The
 * HTML holds the real figure; counting only starts once the script runs.
 */
export function Count({
  figure,
  progress,
  from = 0,
  to = 1,
  className,
}: {
  figure: string;
  /** A chapter's progress; without one the figure counts on its own way up the screen. */
  progress?: MotionValue<number>;
  from?: number;
  to?: number;
  className?: string;
}) {
  const animated = useCopyMotion();
  const reduce = useReducedMotion();
  const still = !animated || reduce;
  const ref = useRef<HTMLSpanElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.95", "start 0.6"],
  });
  const source = progress ?? scrollYProgress;
  const parts = splitFigure(figure);

  function paint(value: number) {
    if (!ref.current || !parts) return;
    if (still) {
      ref.current.textContent = figure;
      return;
    }
    const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
    const eased = 1 - (1 - t) ** 3;
    // Every number in the figure counts together, so "95–97%" stays a range.
    ref.current.textContent = figure.replace(/\d+(?:\.\d+)?/g, (found) =>
      String(Math.round(Number(found) * eased)),
    );
  }

  useMotionValueEvent(source, "change", paint);
  // biome-ignore lint/correctness/useExhaustiveDependencies: paint once on mount with the current scroll.
  useEffect(() => paint(source.get()), []);

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ""}`}>
      {figure}
    </span>
  );
}
