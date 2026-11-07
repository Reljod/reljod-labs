"use client";

import { useEffect, useReducer, useRef } from "react";
import type { DocumentKind } from "../../domain/types";
import type { ScanState } from "../../scan-state";

export type Playhead = {
  /** Which Document is on screen, as an index into the pack's display order. */
  index: number;
  /** How many of its readings have been revealed. */
  revealed: number;
  /** Whether its Field checks have been stamped. */
  stamped: boolean;
  hold: number;
  finished: boolean;
};

const START: Playhead = {
  index: 0,
  revealed: 0,
  stamped: false,
  hold: 0,
  finished: false,
};

/** Ticks spent on a stamped Document before moving to the next. */
const HOLD_TICKS = 5;

function advance(head: Playhead, total: number): Playhead {
  const index = head.index + 1;
  return index >= total ? { ...head, finished: true } : { ...START, index };
}

function step(head: Playhead, scan: ScanState, kinds: DocumentKind[]) {
  if (head.finished) return head;
  const kind = kinds[head.index];
  if (!kind) return { ...head, finished: true };
  const document = scan.documents[kind];
  const failed =
    document.stages.parse === "error" || document.stages.read === "error";

  if (head.revealed < document.readings.length) {
    return { ...head, revealed: head.revealed + 1 };
  }
  if (document.checks && !head.stamped) {
    return { ...head, stamped: true, hold: HOLD_TICKS };
  }
  if (head.stamped || (failed && scan.end)) {
    return head.hold > 0
      ? { ...head, hold: head.hold - 1 }
      : advance(head, kinds.length);
  }
  if (scan.end?.status === "failed") return { ...head, finished: true };
  return head;
}

type Action =
  | { type: "tick"; scan: ScanState; kinds: DocumentKind[] }
  | { type: "reset" }
  | { type: "skip" };

function reducer(head: Playhead, action: Action): Playhead {
  switch (action.type) {
    case "reset":
      return START;
    case "skip":
      return { ...head, finished: true };
    case "tick":
      return step(head, action.scan, action.kinds);
  }
}

/**
 * Plays Documents one at a time in display order, revealing each reading and
 * then its Field checks, however far ahead the real run has got.
 */
export function usePlayhead(
  scan: ScanState,
  kinds: DocumentKind[],
  options: { tickMs: number; resetKey: unknown },
) {
  const [head, dispatch] = useReducer(reducer, START);
  const latest = useRef({ scan, kinds });
  latest.current = { scan, kinds };

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey restarts playback on purpose
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [options.resetKey]);

  useEffect(() => {
    const timer = setInterval(
      () => dispatch({ type: "tick", ...latest.current }),
      options.tickMs,
    );
    return () => clearInterval(timer);
  }, [options.tickMs]);

  return { head, skip: () => dispatch({ type: "skip" }) };
}
