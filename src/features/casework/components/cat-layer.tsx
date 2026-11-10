"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
} from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Cat, type CatPose } from "@/features/ledger/components/cat";
import { chooseGait } from "@/features/ledger/domain/gait";

const SIZE = 76;
const HEIGHT = Math.round((SIZE * 250) / 240);

export type CatCue = {
  /** Where he should stand: the element he perches on, by its top edge. */
  target: HTMLElement | null;
  /** What he does once there. */
  pose: CatPose;
  /** A few words in a speech bubble, or none. */
  line?: string;
  /** Stand left of the target's centre instead of on it. */
  align?: "center" | "left" | "right";
};

/**
 * Ledger, loose on the desk: given a cue he runs to its element (side-on,
 * up, down or flying, by direction) and strikes its pose there.
 */
export function CatLayer({ cue }: { cue: CatCue }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const position = useRef<{ x: number; y: number } | null>(null);
  const motionRef = useRef<{ stop: () => void } | null>(null);
  const [pose, setPose] = useState<CatPose>("wave");
  const [flip, setFlip] = useState(false);
  const [rot, setRot] = useState(0);
  const [line, setLine] = useState<string | undefined>(undefined);

  const spot = useCallback((next: CatCue) => {
    const rect = next.target?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const x =
      next.align === "left"
        ? rect.left - SIZE * 0.6
        : next.align === "right"
          ? rect.right - SIZE * 0.4
          : rect.left + rect.width / 2 - SIZE / 2;
    return {
      x: Math.max(4, Math.min(window.innerWidth - SIZE - 4, x)),
      y: Math.max(4, rect.top - HEIGHT + 10),
    };
  }, []);

  useEffect(() => {
    const element = ref.current;
    const to = spot(cue);
    if (!element || !to) return;
    const from = position.current;
    motionRef.current?.stop();
    setLine(undefined);
    if (!from || reduceMotion) {
      element.style.transform = `translate(${to.x}px, ${to.y}px)`;
      position.current = to;
      setPose(cue.pose);
      setRot(0);
      setLine(cue.line);
      return;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.hypot(dx, dy) < 6) {
      setPose(cue.pose);
      setLine(cue.line);
      return;
    }
    const gait = chooseGait(dx, dy, Math.hypot(dx, dy) > 500 ? "dash" : "trot");
    setPose(gait.pose);
    setFlip(gait.flip);
    setRot(gait.rot);
    const controls = animate(
      element,
      {
        transform: [
          `translate(${from.x}px, ${from.y}px)`,
          `translate(${to.x}px, ${to.y}px)`,
        ],
      },
      { duration: Math.min(1.4, gait.duration), ease: [0.45, 0.05, 0.25, 1] },
    );
    motionRef.current = controls;
    controls.then(() => {
      position.current = to;
      setRot(0);
      setFlip(false);
      setPose(cue.pose);
      setLine(cue.line);
    });
    // Mid-run, remember roughly where he is, so a new cue starts from there.
    position.current = to;
  }, [cue, spot, reduceMotion]);

  // Keep him on his perch when the layout moves under him.
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const settle = () => {
      const to = spot(cue);
      if (!to) return;
      element.style.transform = `translate(${to.x}px, ${to.y}px)`;
      position.current = to;
    };
    const observer = new ResizeObserver(() => settle());
    observer.observe(document.body);
    if (cue.target) observer.observe(cue.target);
    window.addEventListener("resize", settle);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", settle);
    };
  }, [cue, spot]);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed top-0 left-0 z-30"
      style={{ width: SIZE, height: HEIGHT }}
      aria-hidden="true"
    >
      <AnimatePresence>
        {line ? (
          <motion.p
            key={line}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-full left-1/2 mb-1 w-max max-w-48 -translate-x-1/2 rounded-sm border-2 border-ink bg-paper px-2 py-1 text-center font-mono text-[10px] leading-tight font-bold tracking-[0.04em] uppercase shadow-hard-sm"
          >
            {line}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <Cat pose={pose} flip={flip} rot={rot} size={SIZE} />
    </div>
  );
}
