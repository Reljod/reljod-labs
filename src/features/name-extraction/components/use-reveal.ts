"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtractedName } from "../domain/contract";
import { firstPage } from "./plain";

const keyOf = (name: ExtractedName) => name.canonical.trim().toLowerCase();
const STEP_MS = 70;

/**
 * Lets names in a few at a time, in the order they became visible (by first
 * page within a batch), so a batch of 130 streams in over a second or two
 * instead of landing at once. Shows everything at once under reduced motion.
 */
export function useReveal(
  candidates: ExtractedName[],
  /** Changes when the Run starts over (a replay restarted, another Run). */
  resetKey: string,
): ExtractedName[] {
  const reduce = useReducedMotion();
  const order = useRef<string[]>([]);
  const known = useRef(new Map<string, ExtractedName>());
  const lastKey = useRef(resetKey);
  const [count, setCount] = useState(0);

  // Once let in, a name stays (a page a second reader re-reads does not hide it).
  const ordered = useMemo(() => {
    if (lastKey.current !== resetKey) {
      lastKey.current = resetKey;
      order.current = [];
      known.current = new Map();
    }
    const fresh = candidates
      .filter((name) => !known.current.has(keyOf(name)))
      .sort((a, b) => firstPage(a) - firstPage(b));
    for (const name of candidates) known.current.set(keyOf(name), name);
    order.current = [...order.current, ...fresh.map(keyOf)];
    return order.current;
  }, [candidates, resetKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new resetKey starts the drip over
  useEffect(() => {
    setCount(0);
  }, [resetKey]);

  const total = ordered.length;
  useEffect(() => {
    if (reduce) {
      setCount(total);
      return;
    }
    if (count >= total) {
      if (count > total) setCount(total);
      return;
    }
    const started = performance.now();
    const timer = setTimeout(() => {
      // A busy main thread fires late; let in as many names as the wait was long.
      const steps = Math.max(1, (performance.now() - started) / STEP_MS);
      setCount((value) =>
        Math.min(
          total,
          value + Math.ceil(steps * Math.max(1, (total - value) / 6)),
        ),
      );
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [count, total, reduce]);

  return useMemo(
    () =>
      ordered.slice(0, Math.min(count, total)).flatMap((key) => {
        const name = known.current.get(key);
        return name ? [name] : [];
      }),
    [ordered, count, total],
  );
}
