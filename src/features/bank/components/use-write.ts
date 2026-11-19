"use client";

import { useCallback, useRef, useState } from "react";
import { messageOf } from "./api";

/**
 * One guarded write for a button ("A write button fires once" in
 * docs/engineering/conventions.md). `run` cannot start twice: a synchronous
 * ref guard holds from the click, before any state update lands. While it
 * runs `pending` is true (disable the button, show the pending label); after
 * it, `result` or `error` says what happened, to show where it was clicked.
 *
 * `run` resolves to the result, or to undefined when the write failed or one
 * was already running; it never rejects.
 */
export function useWrite<Args extends unknown[], Result>(
  write: (...args: Args) => Promise<Result>,
) {
  const running = useRef(false);
  const latest = useRef(write);
  latest.current = write;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = useCallback(
    async (...args: Args): Promise<Result | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setPending(true);
      setError(null);
      try {
        const value = await latest.current(...args);
        setResult(value);
        return value;
      } catch (caught) {
        setError(messageOf(caught));
        return undefined;
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  return { run, pending, error, result, reset };
}
