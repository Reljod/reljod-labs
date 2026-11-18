"use client";

import { motion, useScroll } from "motion/react";
import { useRef } from "react";
import { useCopyMotion } from "./copy-motion";

type Props = { axis: "x" | "y"; className: string };

/**
 * A brass rule drawn along a list as you scroll through it: across (`x`) or
 * down (`y`). Decoration only; nothing renders outside a moving page.
 */
export function ScrollRule(props: Props) {
  const animated = useCopyMotion();
  return animated ? <Driven {...props} /> : null;
}

function Driven({ axis, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset:
      axis === "x" ? ["start 0.9", "start 0.4"] : ["start 0.6", "end 0.6"],
  });
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute ${className}`}
    >
      <motion.span
        className={`scroll-rule block size-full bg-brass ${axis === "x" ? "origin-left" : "origin-top"}`}
        style={
          axis === "x"
            ? { scaleX: scrollYProgress }
            : { scaleY: scrollYProgress }
        }
      />
    </span>
  );
}
