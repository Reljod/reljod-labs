"use client";

import { useEffect, useMemo } from "react";

/** `setTimeout` that is cleared when the component unmounts, so a scene never updates after it leaves. */
export function useTimers() {
  const timers = useMemo(() => {
    const pending = new Set<number>();
    return {
      later(run: () => void, ms: number) {
        const id = window.setTimeout(() => {
          pending.delete(id);
          run();
        }, ms);
        pending.add(id);
      },
      clearAll() {
        for (const id of pending) window.clearTimeout(id);
        pending.clear();
      },
    };
  }, []);
  useEffect(() => timers.clearAll, [timers]);
  return timers;
}
