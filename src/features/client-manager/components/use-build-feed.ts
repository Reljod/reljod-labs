"use client";

import { useEffect, useReducer, useRef } from "react";
import {
  type BuildState,
  buildReducer,
  initialBuildState,
} from "../domain/build-state";
import type { BuildEvent } from "../domain/events";
import type { DraftGraph } from "../domain/graph";
import { readNdjson } from "./ndjson";

type Action =
  | { type: "event"; event: BuildEvent }
  | { type: "reset"; key: string; base?: DraftGraph };

type FeedState = { key: string | null; build: BuildState };

function reducer(state: FeedState, action: Action): FeedState {
  return action.type === "reset"
    ? { key: action.key, build: initialBuildState(action.base) }
    : { ...state, build: buildReducer(state.build, action.event) };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * A live Build's events folded into state. A dropped connection resumes from
 * the last event applied, until `end` arrives; a Build that isn't started yet
 * is retried for a little while.
 */
export function useBuildFeed(buildId: string | null, base?: DraftGraph) {
  const [state, dispatch] = useReducer(reducer, {
    key: null,
    build: initialBuildState(),
  });
  const received = useRef(0);
  received.current = state.build.received;
  // An addition replays its Repairs over the graph it started from.
  const baseRef = useRef(base);
  baseRef.current = base;

  useEffect(() => {
    if (!buildId) return;
    const controller = new AbortController();
    const { signal } = controller;
    dispatch({ type: "reset", key: buildId, base: baseRef.current });
    received.current = 0;
    void (async () => {
      let misses = 0;
      while (!signal.aborted) {
        let ended = false;
        try {
          const response = await fetch(
            `/api/client-manager/builds/${buildId}/events?from=${received.current}`,
            { signal, cache: "no-store" },
          );
          if (response.status === 404 && misses++ < 20) {
            await sleep(800, signal);
            continue;
          }
          if (!response.ok) return;
          for await (const event of readNdjson<BuildEvent>(response)) {
            dispatch({ type: "event", event });
            if (event.type === "end") ended = true;
          }
        } catch {
          // Network blip or a function timeout: reconnect below.
        }
        if (ended) return;
        await sleep(1000, signal);
      }
    })();
    return () => controller.abort();
  }, [buildId]);

  if (buildId && state.key !== buildId) return initialBuildState();
  return state.build;
}
