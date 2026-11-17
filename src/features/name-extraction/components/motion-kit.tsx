"use client";

import {
  type MotionValue,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect } from "react";

/** A number that springs to its new value; jumps under reduced motion. */
export function Ticker({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 140, damping: 26, mass: 0.6 });
  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);
  const text = useTransform(spring, format);
  return <motion.span className={className}>{text}</motion.span>;
}

/** A motion value shown as text, re-rendering nothing. */
export function Clock({
  value,
  format,
  className,
}: {
  value: MotionValue<number>;
  format: (value: number) => string;
  className?: string;
}) {
  const text = useTransform(value, format);
  return <motion.span className={className}>{text}</motion.span>;
}

/** Springs used across Sieve, so everything moves with one feel. */
export const SPRING = { type: "spring", stiffness: 380, damping: 32 } as const;
export const SOFT = { type: "spring", stiffness: 160, damping: 24 } as const;
