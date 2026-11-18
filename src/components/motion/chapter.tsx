"use client";

import {
  type MotionValue,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
} from "motion/react";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import "./motion.css";
import { useReduced } from "./use-reduced";

const ChapterProgress = createContext<MotionValue<number> | null>(null);

/** The scroll progress (0 to 1) of the chapter around this component. */
export function useChapterProgress(): MotionValue<number> {
  const progress = useContext(ChapterProgress);
  if (!progress) throw new Error("useChapterProgress outside a Chapter");
  return progress;
}

/** The sticky site header's height, in px; the stage pins just under it. */
const HEADER = 66;

/**
 * A chapter's scroll range (what `useScroll` maps to 0..1: from its top at the
 * top of the window to its bottom at the bottom), and how much of that range
 * the next section spends sliding over it.
 */
function measure(sectionHeight: number, covered: boolean) {
  if (typeof window === "undefined") return { range: 0, share: 0 };
  const range = sectionHeight - window.innerHeight;
  const stage = window.innerHeight - HEADER;
  const share = covered && range > 0 ? Math.min(0.9, stage / range) : 0;
  return { range, share };
}

/** The page offset at which `section` (a covered Chapter) shows progress `p`. */
export function chapterScrollTop(section: HTMLElement, p: number): number {
  const { range, share } = measure(section.offsetHeight, true);
  return section.offsetTop + p * (1 - share) * Math.max(0, range);
}

/**
 * A pinned chapter: the section is `length` screens tall and its stage stays
 * on screen while you scroll through it, so scrolling plays the scene instead
 * of moving the page. The stage gets the progress as the CSS variable `--p`.
 *
 * The next section slides up over the finished stage like a sheet laid on a
 * pile (`overlap` on that section, or the `slide-over` class): the scene
 * plays out over the first `length - 2` screens and holds its last frame for
 * the final one, darkening a little as it's covered.
 *
 * With reduced motion nothing is pinned (motion.css) and the stage shows its
 * last frame. The markup never depends on that setting, so hydration matches.
 */
export function Chapter({
  id,
  label,
  length,
  overlap = false,
  covered = true,
  className = "",
  stageClassName = "",
  children,
}: {
  id: string;
  /** The chapter's accessible name. */
  label: string;
  /** Section height in screens, including the one the next section covers it in. */
  length: number;
  /** Slides up over the previous chapter instead of following it. */
  overlap?: boolean;
  /**
   * Whether the next section slides over this one (it holds its last frame
   * for that screen). False when plain page content simply follows it.
   */
  covered?: boolean;
  className?: string;
  stageClassName?: string;
  children: ReactNode;
}) {
  const reduce = useReduced();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  // Stable values the scene subscribes to: how far it has played (0..1), and
  // how dark it is while the next section covers it.
  const progress = useMotionValue(0);
  const dim = useMotionValue(0);
  const update = (raw: number) => {
    if (reduce) {
      progress.set(1);
      dim.set(0);
      return;
    }
    const { share } = measure(ref.current?.offsetHeight ?? 0, covered);
    progress.set(Math.min(1, raw / (1 - share)));
    dim.set(share > 0 ? Math.max(0, (raw - (1 - share)) / share) * 0.45 : 0);
  };
  useMotionValueEvent(scrollYProgress, "change", update);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the setting changes or the scene mounts.
  useEffect(() => update(scrollYProgress.get()), [reduce]);

  return (
    <section
      id={id}
      ref={ref}
      aria-label={label}
      className={`chapter relative border-ink border-t-2 ${overlap ? "slide-over" : ""} ${className}`}
      style={{ height: `${length * 100}svh` }}
    >
      <ChapterProgress value={progress}>
        <motion.div
          className={`chapter-stage sticky overflow-hidden ${stageClassName}`}
          style={{ "--p": progress } as unknown as CSSProperties}
        >
          {children}
          <motion.span
            aria-hidden="true"
            className="chapter-dim pointer-events-none absolute inset-0 z-20 bg-ink"
            style={{ opacity: dim }}
          />
        </motion.div>
      </ChapterProgress>
    </section>
  );
}
