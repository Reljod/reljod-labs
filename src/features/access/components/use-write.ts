"use client";

import { useCallback, useRef, useState } from "react";
import type { Outcome } from "@/platform/client/api";

/**
 * One write a form or button sends, once at a time: `pending` disables the
 * button and shows its pending label, and a ref closes the gap before that
 * render, so a fast double click or a second Enter sends nothing. `outcome`
 * is what to show where it was clicked.
 */
export function useWrite<T>() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null);

  const run = useCallback(
    async (write: () => Promise<Outcome<T>>): Promise<Outcome<T> | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(true);
      try {
        const result = await write();
        setOutcome(result);
        return result;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [],
  );

  return { run, pending, outcome };
}
