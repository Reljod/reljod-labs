"use client";

import {
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
} from "motion/react";
import { type CSSProperties, useEffect, useRef } from "react";
import "./motion.css";
import { useCopyMotion } from "./copy-motion";
import { seg } from "./scroll-math";

type Timing =
  /** Plays once on load, over `duration` seconds (an opening headline). */
  | { on: "mount"; delay?: number; duration?: number }
  /** Scrubbed by the line's own trip up the screen. */
  | { on: "scroll"; offset?: [string, string] }
  /** Scrubbed by a window of the surrounding Chapter's `--p`. */
  | { on: "chapter"; from: number; to: number };

/**
 * Words under redaction bars that lift as you go, like a bank document being
 * declassified. Screen readers get the line once; the bars are decoration.
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

  const body = (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, index) => (
          <span key={`${index}-${word}`}>
            <span
              className="peel-w"
              style={
                {
                  "--at":
                    words.length > 1 ? (index / (words.length - 1)) * span : 0,
                } as CSSProperties
              }
            >
              {word}
            </span>
            {index < words.length - 1 ? " " : null}
          </span>
        ))}
      </span>
    </>
  );

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
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset:
      timing.on === "scroll"
        ? ((timing.offset ?? ["start 0.95", "start 0.5"]) as never)
        : undefined,
  });
  const mounted = useMotionValue(reduce ? 1 : 0);

  useEffect(() => {
    if (timing.on !== "mount") return;
    if (reduce) {
      mounted.set(1);
      return;
    }
    const controls = animate(mounted, 1, {
      duration: timing.duration ?? 1.1,
      delay: timing.delay ?? 0,
      ease: [0.35, 0, 0.2, 1],
    });
    return () => controls.stop();
  }, [timing, reduce, mounted]);

  const q: MotionValue<number> =
    reduce || timing.on === "mount" ? mounted : scrollYProgress;

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
