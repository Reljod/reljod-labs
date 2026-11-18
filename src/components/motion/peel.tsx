"use client";

import {
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useScroll,
} from "motion/react";
import { type CSSProperties, useEffect, useRef } from "react";
import "./motion.css";
import { useCopyMotion } from "./copy-motion";
import { seg } from "./scroll-math";
import { useReduced } from "./use-reduced";

type Timing =
  /** Plays once on load, over `duration` seconds (an opening headline). */
  | { on: "mount"; delay?: number; duration?: number }
  /** Scrubbed by the line's own trip up the screen. */
  | { on: "scroll"; offset?: [string, string] }
  /** Scrubbed by a window of the surrounding Chapter's `--p`. */
  | { on: "chapter"; from: number; to: number };

/**
 * Words under redaction bars that lift as you go, like a bank document being
 * declassified.
 */
export function Peel({
  text,
  timing,
  className,
}: {
  text: string;
  timing: Timing;
  className?: string;
}) {
  const animated = useCopyMotion();
  const words = text.split(" ");
  if (!animated) return <span className={className}>{text}</span>;
  // Each word clears over `width` of the line's progress; long lines go faster.
  const width = Math.min(0.45, Math.max(0.12, 3.5 / words.length));
  const span = Math.max(0, 1 - width);
  const vars = {
    "--w": width,
    ...(timing.on === "chapter" ? { "--q": seg(timing.from, timing.to) } : {}),
  } as CSSProperties;

  // The words are the text itself; the bars are `::after` decoration, so
  // screen readers, search and copy-paste all get the line once.
  const body = words.map((word, index) => (
    <span key={`${index}-${word}`}>
      <span
        className="peel-w"
        style={
          {
            "--at": words.length > 1 ? (index / (words.length - 1)) * span : 0,
          } as CSSProperties
        }
      >
        {word}
      </span>
      {index < words.length - 1 ? " " : null}
    </span>
  ));

  if (timing.on === "chapter")
    return (
      <span className={`peel ${className ?? ""}`} style={vars}>
        {body}
      </span>
    );
  return (
    <DrivenPeel timing={timing} className={className} vars={vars}>
      {body}
    </DrivenPeel>
  );
}

function DrivenPeel({
  timing,
  className,
  vars,
  children,
}: {
  timing: Exclude<Timing, { on: "chapter" }>;
  className?: string;
  vars: CSSProperties;
  children: React.ReactNode;
}) {
  const reduce = useReduced();
  const ref = useRef<HTMLSpanElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset:
      timing.on === "scroll"
        ? ((timing.offset ?? ["start 0.95", "start 0.5"]) as never)
        : undefined,
  });
  const mounted = useMotionValue(reduce ? 1 : 0);

  const on = timing.on;
  const delay = timing.on === "mount" ? timing.delay : undefined;
  const duration = timing.on === "mount" ? timing.duration : undefined;
  useEffect(() => {
    if (on !== "mount") return;
    if (reduce) {
      mounted.set(1);
      return;
    }
    const controls = animate(mounted, 1, {
      duration: duration ?? 1.1,
      delay: delay ?? 0,
      ease: [0.35, 0, 0.2, 1],
    });
    return () => controls.stop();
  }, [on, delay, duration, reduce, mounted]);

  // Reduced motion only skips the reveal that plays on its own (on mount);
  // one scrubbed by scroll still follows the visitor's scrolling.
  const q: MotionValue<number> =
    timing.on === "mount" ? mounted : scrollYProgress;

  return (
    <motion.span
      ref={ref}
      className={`peel ${className ?? ""}`}
      style={{ ...vars, "--q": q } as unknown as CSSProperties}
    >
      {children}
    </motion.span>
  );
}
