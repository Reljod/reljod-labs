"use client";

import { motion, useReducedMotion, useScroll } from "motion/react";
import { useRef } from "react";
import { useCopyMotion } from "./copy-motion";

/**
 * A brass rule drawn along a list as you scroll through it: across (`x`) or
 * down (`y`). Decoration only; nothing renders outside a moving page.
 */
export function ScrollRule({
  axis,
  className,
}: {
  axis: "x" | "y";
  className: string;
}) {
  const animated = useCopyMotion();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset:
      axis === "x" ? ["start 0.9", "start 0.4"] : ["start 0.6", "end 0.6"],
  });
  if (!animated) return null;
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute ${className}`}
    >
      <motion.span
        className={`block size-full bg-brass ${axis === "x" ? "origin-left" : "origin-top"}`}
        style={
          reduce
            ? undefined
            : axis === "x"
              ? { scaleX: scrollYProgress }
              : { scaleY: scrollYProgress }
        }
      />
    </span>
  );
}
