"use client";

import { useEffect, useReducer, useRef } from "react";
import type { ScanEvent } from "../../scan-events";
import {
  initialScanState,
  replayEvents,
  type ScanState,
  scanReducer,
} from "../../scan-state";
import type { RunView } from "../../view";

export type FeedSource =
  | { mode: "live"; runId: string }
  | { mode: "replay"; view: RunView; key: number }
  | { mode: "idle" };

/** The scan, tagged with the source it came from so a stale one is never shown. */
type FeedState = { key: string | null; scan: ScanState };

type Action =
  | { type: "event"; event: ScanEvent }
  | { type: "reset"; key: string };

function reducer(state: FeedState, action: Action): FeedState {
  return action.type === "reset"
    ? { key: action.key, scan: initialScanState() }
    : { ...state, scan: scanReducer(state.scan, action.event) };
}

const EMPTY = initialScanState();

/** How long a replay waits before releasing each kind of event. */
const REPLAY_DELAY: Record<ScanEvent["type"], number> = {
  stage: 260,
  spans: 520,
  field: 380,
  corrections: 300,
  checks: 700,
  findings: 600,
  end: 300,
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

async function streamLive(
  runId: string,
  from: () => number,
  dispatch: (event: ScanEvent) => void,
  signal: AbortSignal,
) {
  // A dropped connection resumes from the last applied event until `end` arrives.
  while (!signal.aborted) {
    let ended = false;
    try {
      const response = await fetch(
        `/demos/document-compliance/runs/${runId}/events?from=${from()}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok || !response.body) throw new Error(`${response.status}`);
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ScanEvent;
          dispatch(event);
          if (event.type === "end") ended = true;
        }
      }
    } catch {
      // Network blip or function timeout: fall through and reconnect.
    }
    if (ended) return;
    await sleep(1000, signal);
  }
}

async function playReplay(
  view: RunView,
  dispatch: (event: ScanEvent) => void,
  signal: AbortSignal,
) {
  for (const event of replayEvents(view)) {
    await sleep(REPLAY_DELAY[event.type], signal);
    if (signal.aborted) return;
    dispatch({ ...event, at: Date.now() });
  }
}

/** The run's ScanEvents folded into state, from the live stream or a replay. */
export function useScanFeed(source: FeedSource) {
  const [state, dispatch] = useReducer(reducer, { key: null, scan: EMPTY });
  const received = useRef(0);
  received.current = state.scan.received;

  const liveRunId = source.mode === "live" ? source.runId : null;
  const replayView = source.mode === "replay" ? source.view : null;
  const replayKey = source.mode === "replay" ? source.key : null;
  const sourceKey = liveRunId
    ? `live-${liveRunId}`
    : replayKey !== null
      ? `replay-${replayKey}`
      : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: sourceKey names the live run or replay; the view is read once per key
  useEffect(() => {
    if (!sourceKey) return;
    const controller = new AbortController();
    const push = (event: ScanEvent) => dispatch({ type: "event", event });
    dispatch({ type: "reset", key: sourceKey });
    received.current = 0;
    if (liveRunId) {
      void streamLive(
        liveRunId,
        () => received.current,
        push,
        controller.signal,
      );
    } else if (replayView) {
      void playReplay(replayView, push, controller.signal);
    }
    return () => controller.abort();
  }, [sourceKey]);

  // Until the new source's reset lands, the previous scan must not leak through.
  if (sourceKey && state.key !== sourceKey) return EMPTY;
  return state.scan;
}
