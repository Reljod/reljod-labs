"use client";

import { motion, useReducedMotion, useScroll } from "motion/react";
import { type CSSProperties, type ReactNode, useRef } from "react";
import { useCopyMotion } from "./copy-motion";
import "./motion.css";

/**
 * A block that tips up into place as it comes up the screen, scrubbed by
 * scroll. `lean` sets which way it comes from. Outside a moving page (see
 * `CopyMotionProvider`) it renders a plain block.
 */
export function ScrollIn({
  children,
  className,
  lean = 0,
  as = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** Sideways lean while it comes in, in degrees. */
  lean?: number;
  as?: "div" | "li" | "article";
} & Record<`data-${string}`, string>) {
  const animated = useCopyMotion();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 1", "start 0.72"],
  });
  const Tag = motion[as];
  if (!animated || reduce) {
    const Plain = as;
    return (
      <Plain className={className} {...rest}>
        {children}
      </Plain>
    );
  }
  return (
    <Tag
      ref={ref as never}
      className={`scroll-in ${className ?? ""}`}
      style={
        {
          "--q": scrollYProgress,
          "--lean": `${lean}deg`,
        } as unknown as CSSProperties
      }
      {...rest}
    >
      {children}
    </Tag>
  );
}
