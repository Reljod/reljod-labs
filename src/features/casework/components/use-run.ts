"use client";

import { useEffect, useReducer, useRef } from "react";
import type { RunEvent } from "../domain/run-events";
import { emptyRun, type RunView, reduceRun } from "./run-reducer";

type Action = { type: "event"; event: RunEvent } | { type: "reset" };

/** Rule jobs finish in milliseconds; each holds the stage at least this long. */
const DWELL_MS = 1500;

function reducer(view: RunView, action: Action): RunView {
  return action.type === "reset" ? emptyRun : reduceRun(view, action.event);
}

/**
 * Follows a Run's event stream, reconnecting from the last event seen until
 * it ends. Replays of finished runs arrive the same way, all at once.
 */
export function useRun(runId: string | null): RunView {
  const [view, dispatch] = useReducer(reducer, emptyRun);
  const seen = useRef(0);

  useEffect(() => {
    dispatch({ type: "reset" });
    seen.current = 0;
    if (!runId) return;
    const controller = new AbortController();
    let ended = false;
    const queue: RunEvent[] = [];
    let pumping = false;
    let lastStart = 0;

    // Plays events in order, holding each job's start until the last one has had its moment.
    async function pump() {
      if (pumping) return;
      pumping = true;
      while (queue.length > 0 && !controller.signal.aborted) {
        const event = queue[0];
        if (event.type === "job" && event.state === "start") {
          const wait = lastStart + DWELL_MS - Date.now();
          if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
          if (controller.signal.aborted) break;
          lastStart = Date.now();
        }
        queue.shift();
        dispatch({ type: "event", event });
      }
      pumping = false;
    }

    async function follow() {
      for (
        let attempt = 0;
        attempt < 30 && !ended && !controller.signal.aborted;
        attempt++
      ) {
        try {
          const response = await fetch(
            `/api/casework/runs/${runId}/events?from=${seen.current}`,
            {
              signal: controller.signal,
              cache: "no-store",
            },
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
              const event = JSON.parse(line) as RunEvent;
              seen.current += 1;
              queue.push(event);
              void pump();
              if (event.type === "end") ended = true;
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        if (!ended) await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
    void follow();
    return () => controller.abort();
  }, [runId]);

  return view;
}
