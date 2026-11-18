"use client";

import { useEffect, useReducer } from "react";
import { apiPath } from "../domain/api";
import type { RunEvent } from "../domain/contract";
import { ApiError, api } from "./api";
import {
  emptyRunView,
  foldEvents,
  isOver,
  type RunView,
  reduceRunView,
  type SeqEvent,
  withSeq,
} from "./run-view";

type Action =
  | { type: "reset" }
  | { type: "load"; view: RunView }
  | { type: "event"; event: SeqEvent }
  | { type: "missing" };

export type RunState = {
  view: RunView;
  /** The Run is still being fetched. */
  loading: boolean;
  /** No such Run for this Owner. */
  missing: boolean;
};

const initial: RunState = {
  view: emptyRunView,
  loading: false,
  missing: false,
};

function reducer(state: RunState, action: Action): RunState {
  switch (action.type) {
    case "reset":
      return { ...initial, loading: true };
    case "load":
      return { view: action.view, loading: false, missing: false };
    case "event":
      return {
        ...state,
        loading: false,
        view: reduceRunView(state.view, action.event),
      };
    case "missing":
      return { ...initial, missing: true };
  }
}

const RECONNECT_MS = 1200;
const ATTEMPTS = 30;

/**
 * One Run, live. Loads what is stored (the Audit trail so far and the
 * Register), then, while the Run is not over, follows its event stream from
 * the next event, reconnecting until it ends. Opening a finished Run replays
 * its whole trail at once.
 */
export function useRun(runId: string | null): RunState {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    if (!runId) {
      dispatch({ type: "missing" });
      return;
    }
    dispatch({ type: "reset" });
    const controller = new AbortController();
    let seen = 0;
    let ended = false;

    async function follow() {
      for (
        let attempt = 0;
        attempt < ATTEMPTS && !ended && !controller.signal.aborted;
        attempt++
      ) {
        try {
          const response = await fetch(
            apiPath.runEvents(runId ?? "", Math.max(0, seen - 1)),
            { signal: controller.signal, cache: "no-store" },
          );
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
              const event = withSeq(
                JSON.parse(line) as RunEvent & { seq?: number },
                seen,
              );
              seen = Math.max(seen, event.seq + 1);
              dispatch({ type: "event", event });
              if (event.type === "end") ended = true;
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
        const detail = await api
          .run(runId, { signal: controller.signal })
          .catch((error: unknown) => {
            // 404: not this Owner's Run. Anything else: follow the stream.
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
          });
        if (controller.signal.aborted) return;
        if (!detail) {
          dispatch({ type: "missing" });
          return;
        }
        const events = detail.events.map((event, index) =>
          withSeq(event, index),
        );
        const folded = foldEvents(events);
        // The stored Register is the last word; events only rebuild it.
        const view: RunView = {
          ...folded,
          names: detail.names.length > 0 ? detail.names : folded.names,
          status: isOver(folded.status) ? folded.status : detail.status,
          score: folded.score ?? detail.score,
        };
        dispatch({ type: "load", view });
        seen = events.length === 0 ? 0 : view.lastSeq + 1;
        ended = isOver(detail.status) && isOver(view.status);
        if (!ended) await follow();
      } catch {
        if (!controller.signal.aborted) await follow();
      }
    })();
    return () => controller.abort();
  }, [runId]);

  return state;
}
