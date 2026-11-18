"use client";

import {
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
} from "motion/react";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useRef,
} from "react";
import "./motion.css";

const ChapterProgress = createContext<MotionValue<number> | null>(null);

/** The scroll progress (0 to 1) of the chapter around this component. */
export function useChapterProgress(): MotionValue<number> {
  const progress = useContext(ChapterProgress);
  if (!progress) throw new Error("useChapterProgress outside a Chapter");
  return progress;
}

/**
 * A pinned chapter: the section is `length` screens tall and its stage stays
 * on screen while you scroll through it, so scrolling plays the scene instead
 * of moving the page. The stage gets the progress as the CSS variable `--p`.
 *
 * With reduced motion the stage isn't pinned and shows its last frame.
 */
export function Chapter({
  id,
  label,
  length,
  className = "",
  stageClassName = "",
  children,
}: {
  id: string;
  /** The chapter's accessible name. */
  label: string;
  /** Section height in screens; the scene plays over `length - 1` of them. */
  length: number;
  className?: string;
  stageClassName?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  const still = useMotionValue(1);
  const progress = reduce ? still : scrollYProgress;

  return (
    <section
      id={id}
      ref={ref}
      aria-label={label}
      className={`chapter relative border-ink border-t-2 ${className}`}
      style={reduce ? undefined : { height: `${length * 100}svh` }}
    >
      <ChapterProgress value={progress}>
        <motion.div
          className={`chapter-stage overflow-hidden ${reduce ? "relative" : "sticky"} ${stageClassName}`}
          style={{ "--p": progress } as unknown as CSSProperties}
        >
          {children}
        </motion.div>
      </ChapterProgress>
    </section>
  );
}
