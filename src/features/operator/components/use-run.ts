"use client";

import { useEffect, useReducer, useRef } from "react";
import { apiPath } from "../domain/api";
import type { RunDetail, RunEvent } from "../domain/contract";
import { ApiError, api } from "./api";
import {
  emptyRunView,
  foldEvents,
  isOver,
  type RunView,
  viewOfDetail,
} from "./run-view";
import { friendly } from "./ui";

export type RunState = {
  /** The Run this state is of. */
  runId: string | null;
  /** The stored Run as first read: its Task, Expectations and Rulebook. */
  detail: RunDetail | null;
  view: RunView;
  loading: boolean;
  /** No such Run for this Owner. */
  missing: boolean;
  error: string | null;
};

type Action =
  | { type: "reset"; runId: string | null }
  | { type: "load"; runId: string; detail: RunDetail; view: RunView }
  | { type: "events"; runId: string; events: RunEvent[] }
  | { type: "missing"; runId: string }
  | { type: "error"; runId: string; error: string };

const idle: RunState = {
  runId: null,
  detail: null,
  view: emptyRunView,
  loading: false,
  missing: false,
  error: null,
};

function reducer(state: RunState, action: Action): RunState {
  if (action.type === "reset")
    return { ...idle, runId: action.runId, loading: action.runId !== null };
  // An answer for a Run that is no longer open is dropped.
  if (action.runId !== state.runId) return state;
  switch (action.type) {
    case "load":
      return {
        ...state,
        detail: action.detail,
        view: action.view,
        loading: false,
        error: null,
      };
    case "events":
      return { ...state, view: foldEvents(action.events, state.view) };
    case "missing":
      return { ...state, loading: false, missing: true };
    case "error":
      return { ...state, loading: false, error: action.error };
  }
}

/** Finished Runs kept for the visit: a finished Run never changes. */
export type FinishedRuns = Map<string, { detail: RunDetail; view: RunView }>;
const FINISHED_SIZE = 8;

function remember(
  finished: FinishedRuns,
  runId: string,
  entry: { detail: RunDetail; view: RunView },
) {
  finished.delete(runId);
  finished.set(runId, entry);
  while (finished.size > FINISHED_SIZE) {
    const oldest = finished.keys().next().value;
    if (oldest === undefined) break;
    finished.delete(oldest);
  }
}

const RECONNECT_MS = 1200;
const ATTEMPTS = 40;

/**
 * One Run, live. Reads what is stored, then, while the Run is not over,
 * follows its event stream from the last event it has, reconnecting until
 * `end`. Events are folded at most once per animation frame. `finished` is
 * the shell's bounded store of Runs that are over: opening one again makes no
 * request.
 */
export function useRun(runId: string | null, finished: FinishedRuns): RunState {
  const [state, dispatch] = useReducer(reducer, idle);
  /** The Run whose Trail has ended in this hook. */
  const final = useRef<string | null>(null);

  useEffect(() => {
    if (
      runId &&
      final.current === runId &&
      state.runId === runId &&
      state.detail &&
      isOver(state.view.status)
    )
      remember(finished, runId, { detail: state.detail, view: state.view });
  }, [runId, finished, state]);

  useEffect(() => {
    dispatch({ type: "reset", runId });
    if (!runId) return;
    const known = finished.get(runId);
    if (known) {
      dispatch({ type: "load", runId, ...known });
      return;
    }
    final.current = null;
    const controller = new AbortController();
    let lastSeq = -1;
    let ended = false;

    // Streamed events wait for the next animation frame and land together.
    let queue: RunEvent[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (queue.length === 0 || controller.signal.aborted) return;
      dispatch({ type: "events", runId, events: queue });
      queue = [];
    };
    const push = (event: RunEvent) => {
      queue.push(event);
      if (!raf) raf = requestAnimationFrame(flush);
    };

    async function follow() {
      for (
        let attempt = 0;
        attempt < ATTEMPTS && !ended && !controller.signal.aborted;
        attempt++
      ) {
        try {
          // The one stream of the demo; every other read goes through `api`.
          const response = await fetch(
            apiPath.runEvents(runId ?? "", Math.max(0, lastSeq)),
            { signal: controller.signal, cache: "no-store" },
          );
          if (response.status === 404) return;
          if (!response.ok || !response.body)
            throw new Error(String(response.status));
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
              const event = JSON.parse(line) as RunEvent;
              if (typeof event.seq !== "number") continue;
              lastSeq = Math.max(lastSeq, event.seq);
              push(event);
              if (event.type === "end") {
                ended = true;
                final.current = runId;
              }
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        if (!ended)
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
      }
    }

    void (async () => {
      try {
        const detail = await api.run(runId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const view = viewOfDetail(detail);
        dispatch({ type: "load", runId, detail, view });
        lastSeq = view.lastSeq;
        if (isOver(view.status)) final.current = runId;
        else await follow();
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404)
          dispatch({ type: "missing", runId });
        else
          dispatch({
            type: "error",
            runId,
            error: friendly(error, "This Run could not load."),
          });
      }
    })();
    return () => {
      controller.abort();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [runId, finished]);

  // Until the effect has reset it, the state is still the previous Run's.
  return state.runId === runId
    ? state
    : { ...idle, runId, loading: runId !== null };
}

export type RecordedState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; detail: RunDetail; view: RunView };

/** A recorded Run shipped with the site, or "missing" when it is not there yet. */
export function useRecorded(taskId: string | null): RecordedState {
  const [state, setState] = useReducer(
    (_: RecordedState, next: RecordedState) => next,
    taskId ? { kind: "loading" } : { kind: "missing" },
  );
  useEffect(() => {
    if (!taskId) {
      setState({ kind: "missing" });
      return;
    }
    setState({ kind: "loading" });
    const controller = new AbortController();
    api.replay(taskId, { signal: controller.signal }).then(
      (found) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(found?.events)) {
          setState({ kind: "missing" });
          return;
        }
        const detail = { ...found, replay: true };
        setState({ kind: "ready", detail, view: viewOfDetail(detail) });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: "missing" });
      },
    );
    return () => controller.abort();
  }, [taskId]);
  return state;
}
