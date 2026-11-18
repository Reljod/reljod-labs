"use client";

import {
  animate,
  type MotionValue,
  useInView,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import { useEffect, useRef } from "react";
import { useCopyMotion } from "./copy-motion";
import { useReduced } from "./use-reduced";

/**
 * A figure ("7 yrs", "95–97%") that counts up. Inside a Chapter it follows
 * the chapter's progress between `from` and `to`; on its own it counts once,
 * the first time it comes into view, so it never rests on a half-counted
 * (wrong) number. The HTML always holds the real figure.
 */
export function Count({
  figure,
  progress,
  from = 0,
  to = 1,
  className,
}: {
  figure: string;
  /** A chapter's progress; without one the figure counts once when seen. */
  progress?: MotionValue<number>;
  from?: number;
  to?: number;
  className?: string;
}) {
  const animated = useCopyMotion();
  const reduce = useReduced();
  const still = !animated || reduce;
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  const own = useMotionValue(0);
  const source = progress ?? own;

  function paint(value: number) {
    if (!ref.current) return;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: paint on mount, and when the setting arrives.
  useEffect(() => paint(source.get()), [still]);

  useEffect(() => {
    if (progress || !seen || still) return;
    const controls = animate(own, 1, { duration: 0.9, ease: "linear" });
    return () => controls.stop();
  }, [progress, seen, own, still]);

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ""}`}>
      {figure}
    </span>
  );
}
