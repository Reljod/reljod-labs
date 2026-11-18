"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { apiPath } from "../domain/api";
import { isOver, type RunEvent, type RunView } from "../domain/run";
import { fetchRun } from "./api";
import {
  failuresAfter,
  finished,
  foldEvent,
  parseEvent,
  takeLines,
  waitBefore,
} from "./run-stream";

/** How the live feed of a running Run is doing. */
export type Feed = "live" | "reconnecting" | "lost" | "closed";

export type RunState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "error"; error: string }
  | { phase: "ready"; run: RunView };

type Action =
  | { type: "reset"; loading: boolean }
  | { type: "loaded"; run: RunView }
  | { type: "missing" }
  | { type: "failed"; error: string }
  | { type: "events"; events: RunEvent[] };

function reducer(state: RunState, action: Action): RunState {
  switch (action.type) {
    case "reset":
      return action.loading ? { phase: "loading" } : { phase: "idle" };
    case "loaded":
      return { phase: "ready", run: action.run };
    case "missing":
      return { phase: "missing" };
    case "failed":
      return { phase: "error", error: action.error };
    case "events":
      return state.phase === "ready"
        ? { phase: "ready", run: action.events.reduce(foldEvent, state.run) }
        : state;
  }
}

/** Reconnects in a row before the feed is called lost. */
const MAX_FAILURES = 6;

/**
 * Loads a Run (`fetchRun`, a GET the server scopes to the Owner; or a read
 * already under way from `preloaded`, such as a hover prefetch) and, while
 * it is going, follows its event stream from the first event, folding each
 * one in (`foldEvent`). A dropped stream reconnects with `from` = events
 * already received. Bump `generation` to load the same Run again (after a
 * Redo); `retry` does the same after a failure.
 */
export function useRun(
  runId: string | null,
  generation: number,
  onEnd?: (run: RunView | null) => void,
  preloaded?: (runId: string) => Promise<RunView | null> | undefined,
): { state: RunState; feed: Feed; retry: () => void } {
  const [state, dispatch] = useReducer(reducer, { phase: "idle" });
  const [feed, setFeed] = useState<Feed>("closed");
  const [attempt, setAttempt] = useState(0);
  const endRef = useRef(onEnd);
  const preloadedRef = useRef(preloaded);
  const latest = useRef<RunView | null>(null);
  useEffect(() => {
    endRef.current = onEnd;
    preloadedRef.current = preloaded;
    latest.current = state.phase === "ready" ? state.run : null;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` and `attempt` are triggers to load again
  useEffect(() => {
    dispatch({ type: "reset", loading: Boolean(runId) });
    setFeed("closed");
    if (!runId) return;
    const controller = new AbortController();
    const { signal } = controller;
    // Events land in one render per frame, not one each: a replay from the
    // first event can be hundreds of lines in one read.
    let queued: RunEvent[] = [];
    let frame: number | null = null;
    const flush = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (queued.length === 0 || signal.aborted) return;
      const events = queued;
      queued = [];
      dispatch({ type: "events", events });
    };
    const queue = (event: RunEvent) => {
      queued.push(event);
      frame ??= requestAnimationFrame(flush);
    };

    async function follow(id: string) {
      let seen = 0;
      let last: RunEvent | null = null;
      let failures = 0;
      setFeed("live");
      while (!signal.aborted) {
        const seenBefore = seen;
        let threw = false;
        try {
          const response = await fetch(apiPath.runEvents(id, seen), {
            signal,
            cache: "no-store",
          });
          if (!response.ok || !response.body) {
            throw new Error(`The live feed answered ${response.status}.`);
          }
          setFeed("live");
          const reader = response.body
            .pipeThrough(new TextDecoderStream())
            .getReader();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const { lines, rest } = takeLines(buffer, value);
            buffer = rest;
            for (const line of lines) {
              seen += 1;
              const event = parseEvent(line);
              if (!event) continue;
              last = event;
              queue(event);
            }
          }
          flush();
          if (finished(last)) {
            setFeed("closed");
            // Let the last events render before the caller refreshes around them.
            setTimeout(() => endRef.current?.(latest.current), 0);
            return;
          }
        } catch {
          if (signal.aborted) return;
          threw = true;
        }
        failures = failuresAfter(failures, {
          delivered: seen - seenBefore,
          threw,
        });
        if (failures >= MAX_FAILURES) {
          setFeed("lost");
          return;
        }
        // A stream that closed after new events is picked up again at once.
        if (failures > 0) setFeed("reconnecting");
        await new Promise((resolve) =>
          setTimeout(resolve, waitBefore(failures)),
        );
      }
    }

    void (async () => {
      try {
        const run = await (preloadedRef.current?.(runId) ??
          fetchRun(runId, signal));
        if (signal.aborted) return;
        if (!run) {
          dispatch({ type: "missing" });
          return;
        }
        if (isOver(run.status)) {
          dispatch({ type: "loaded", run });
          return;
        }
        dispatch({ type: "loaded", run });
        await follow(runId);
      } catch (error) {
        if (signal.aborted) return;
        dispatch({
          type: "failed",
          error:
            error instanceof Error && error.message
              ? error.message
              : "The Run could not be loaded.",
        });
      }
    })();

    return () => {
      controller.abort();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [runId, generation, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, feed, retry };
}
