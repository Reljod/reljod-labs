"use client";

import { useEffect, useReducer, useRef } from "react";
import type { DocumentKind } from "../../domain/types";
import {
  followRun,
  type Playhead,
  pinDocument,
  startPlayhead,
  stepPlayhead,
} from "../../playhead";
import type { ScanState } from "../../scan-state";

type Action =
  | { type: "tick"; scan: ScanState; kinds: DocumentKind[] }
  | { type: "reset"; key: unknown }
  | { type: "pin"; kind: DocumentKind }
  | { type: "follow" }
  | { type: "skip" };

function reducer(head: Playhead, action: Action): Playhead {
  switch (action.type) {
    case "reset":
      return startPlayhead(action.key);
    case "skip":
      return { ...head, finished: true };
    case "pin":
      return pinDocument(head, action.kind);
    case "follow":
      return followRun(head);
    case "tick":
      return stepPlayhead(head, action.scan, action.kinds);
  }
}

/**
 * Plays the run's Documents one at a time, revealing each reading and then its
 * Field checks. It follows whichever Document has output first, unless the
 * visitor pins one to look at.
 */
export function usePlayhead(
  scan: ScanState,
  kinds: DocumentKind[],
  options: { tickMs: number; resetKey: unknown },
) {
  const [head, dispatch] = useReducer(reducer, null, () => startPlayhead(null));
  const latest = useRef({ scan, kinds });
  latest.current = { scan, kinds };

  useEffect(() => {
    dispatch({ type: "reset", key: options.resetKey });
  }, [options.resetKey]);

  useEffect(() => {
    const timer = setInterval(
      () => dispatch({ type: "tick", ...latest.current }),
      options.tickMs,
    );
    return () => clearInterval(timer);
  }, [options.tickMs]);

  return {
    // Until the reset for a new playback lands, the old head must not leak through.
    head:
      head.key === options.resetKey ? head : startPlayhead(options.resetKey),
    skip: () => dispatch({ type: "skip" }),
    pin: (kind: DocumentKind) => dispatch({ type: "pin", kind }),
    follow: () => dispatch({ type: "follow" }),
  };
}
