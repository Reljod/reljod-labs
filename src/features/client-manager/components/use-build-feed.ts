"use client";

import { useEffect, useReducer, useRef } from "react";
import { ApiError } from "@/platform/client/api";
import {
  type BuildState,
  buildReducer,
  initialBuildState,
} from "../domain/build-state";
import type { BuildEvent } from "../domain/events";
import type { DraftGraph } from "../domain/graph";
import { followBuild, isGone } from "./api";

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
          await followBuild(
            buildId,
            received.current,
            (event) => {
              dispatch({ type: "event", event });
              if (event.type === "end") ended = true;
            },
            { signal },
          );
        } catch (error) {
          // Not started yet: ask again in a moment, for a little while.
          if (isGone(error) && misses++ < 20) {
            await sleep(800, signal);
            continue;
          }
          // Refused for good (no Access, not this Owner's): stop asking.
          if (error instanceof ApiError) return;
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
