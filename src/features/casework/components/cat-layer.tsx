"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Cat, type CatPose } from "@/features/ledger/components/cat";
import { chooseGait } from "@/features/ledger/domain/gait";

const SIZE = 132;
const HEIGHT = Math.round((SIZE * 250) / 240);
const MARGIN = 12;

export type CatCue = {
  /** What he does once he is where he is going. */
  pose: CatPose;
  /** A few words in a speech bubble, or none. */
  line?: string;
  /** Perch on top of this element; without it he goes home to the bottom right. */
  on?: HTMLElement | null;
  /** Take the left-to-right position from this element instead of the middle of `on`. */
  along?: HTMLElement | null;
  /** Nothing to do: wander anywhere on the desk between rests. */
  roam?: boolean;
};

type Point = { x: number; y: number };

function bounds(floor: number) {
  return {
    minX: MARGIN,
    maxX: Math.max(MARGIN, window.innerWidth - SIZE - MARGIN),
    minY: 52,
    maxY: Math.max(52, window.innerHeight - floor - HEIGHT + 6),
  };
}

function clamp(point: Point, floor: number): Point {
  const box = bounds(floor);
  return {
    x: Math.min(box.maxX, Math.max(box.minX, point.x)),
    y: Math.min(box.maxY, Math.max(box.minY, point.y)),
  };
}

/**
 * Ledger, loose on the desk. He lives in his own fixed layer above every
 * panel, drawer and dialog, so nothing on the page can move, clip or cover
 * him, and he can go anywhere on it. Home is the bottom right. A cue sends
 * him to perch on the element where the work is; with nothing to do he
 * wanders, side-on, up, down or flying, by direction.
 */
export function CatLayer({ cue, floor }: { cue: CatCue; floor: number }) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const placed = useRef(false);
  const walk = useRef<{ stop: () => void }[]>([]);
  const [pose, setPose] = useState<CatPose>("wave");
  const [flip, setFlip] = useState(false);
  const [rot, setRot] = useState(0);
  const [line, setLine] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);

  // He starts at home, already standing there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed once, then kept inside on resize
  useEffect(() => {
    const home = bounds(floor);
    x.set(home.maxX);
    y.set(home.maxY);
    placed.current = true;
    setReady(true);
    const keepInside = () => {
      const inside = clamp({ x: x.get(), y: y.get() }, floor);
      x.set(inside.x);
      y.set(inside.y);
    };
    window.addEventListener("resize", keepInside);
    return () => window.removeEventListener("resize", keepInside);
  }, [x, y]);

  useEffect(() => {
    if (!placed.current) return;
    let cancelled = false;
    let rest: ReturnType<typeof setTimeout> | undefined;
    const halt = () => {
      for (const controls of walk.current) controls.stop();
      walk.current = [];
    };

    const go = (target: Point, pace: "stroll" | "trot", arrive: () => void) => {
      halt();
      const from = { x: x.get(), y: y.get() };
      const to = clamp(target, floor);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.hypot(dx, dy) < 8 || reduceMotion) {
        x.set(to.x);
        y.set(to.y);
        setRot(0);
        setFlip(false);
        arrive();
        return;
      }
      const gait = chooseGait(dx, dy, pace);
      setLine(undefined);
      setFlip(gait.flip);
      setRot(gait.rot);
      setPose(gait.pose);
      const options = {
        duration: Math.min(pace === "stroll" ? 7 : 2.2, gait.duration),
        // Eases off the mark and into the stop; steady in between.
        ease: [0.3, 0, 0.3, 1] as [number, number, number, number],
      };
      walk.current = [
        animate(x, to.x, options),
        animate(y, to.y, {
          ...options,
          onComplete: () => {
            if (cancelled) return;
            setFlip(false);
            setRot(0);
            arrive();
          },
        }),
      ];
    };

    const settle = () => {
      setPose(cue.pose);
      setLine(cue.line);
    };

    const wander = () => {
      if (cancelled) return;
      rest = setTimeout(
        () => {
          if (cancelled) return;
          const box = bounds(floor);
          go(
            {
              x: box.minX + Math.random() * (box.maxX - box.minX),
              y: box.minY + Math.random() * (box.maxY - box.minY),
            },
            "stroll",
            () => {
              setPose(Math.random() < 0.25 ? "wave" : "idle");
              wander();
            },
          );
        },
        3500 + Math.random() * 5000,
      );
    };

    const rect = cue.on?.getBoundingClientRect();
    const along = cue.along?.getBoundingClientRect();
    const middle =
      along && along.width > 0
        ? along.left + along.width / 2
        : rect
          ? rect.left + rect.width / 2
          : 0;
    const home = bounds(floor);
    const target: Point =
      rect && rect.width > 0
        ? {
            x: middle - SIZE / 2,
            // His feet on the element's top edge.
            y: rect.top - HEIGHT + 14,
          }
        : cue.roam
          ? { x: x.get(), y: y.get() }
          : { x: home.maxX, y: home.maxY };
    go(target, "trot", () => {
      settle();
      if (cue.roam) wander();
    });

    return () => {
      cancelled = true;
      clearTimeout(rest);
      halt();
    };
  }, [cue, floor, x, y, reduceMotion]);

  return (
    <motion.div
      className="pointer-events-none fixed top-0 left-0 z-[90]"
      style={{
        x,
        y,
        width: SIZE,
        height: HEIGHT,
        opacity: ready ? 1 : 0,
      }}
      aria-hidden="true"
    >
      <AnimatePresence>
        {line ? (
          <motion.p
            key={line}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute right-2 bottom-full mb-0.5 w-max max-w-56 rounded-sm border-2 border-ink bg-paper px-2.5 py-1.5 text-center font-mono text-[11px] leading-tight font-bold tracking-[0.04em] uppercase shadow-hard-sm"
          >
            {line}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <Cat pose={pose} flip={flip} rot={rot} size={SIZE} />
    </motion.div>
  );
}
