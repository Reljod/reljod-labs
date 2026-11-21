"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Recording, Source, Usage, WalkEvent } from "../domain/api";
import type { Site } from "../domain/sites";
import type { Finding, Noticed, RefusalReason, Sighting } from "../domain/walk";
import { streamWalk } from "./api";

export type Mode = "replay" | "live";
export type Phase = "idle" | "loading" | "walking" | "done" | "error";

/** What the page is walking: a Sample Site, or the visitor's own footage. */
export type Footage =
  | { kind: "sample"; site: Site; src: string; poster: string }
  | { kind: "upload"; path: string; src: string; name: string };

export type RawLine = {
  line: string;
  outcome: "zone" | "finding" | "merged" | "noticed" | "refused" | "skipped";
};

export type WalkState = {
  phase: Phase;
  mode: Mode;
  model: string | null;
  seconds: number;
  rules: string[];
  zones: { at: number; zone: string }[];
  findings: Finding[];
  noticed: Noticed[];
  refused: { reason: RefusalReason; sighting: Sighting }[];
  raw: RawLine[];
  /** The furthest second the Walker has written about: how far it has "watched". */
  readHead: number;
  startedAt: number | null;
  done: { ms: number; usage: Usage; skipped: number } | null;
  error: string | null;
  /** Bumped on every new Walk, so views can restart their animations. */
  runId: number;
};

const EMPTY: WalkState = {
  phase: "idle",
  mode: "replay",
  model: null,
  seconds: 0,
  rules: [],
  zones: [],
  findings: [],
  noticed: [],
  refused: [],
  raw: [],
  readHead: 0,
  startedAt: null,
  done: null,
  error: null,
  runId: 0,
};

type Action =
  | { type: "begin"; mode: Mode }
  | { type: "event"; event: WalkEvent }
  | { type: "fail"; message: string }
  | { type: "reset" };

function outcomeOf(event: WalkEvent): RawLine["outcome"] | null {
  if (event.t === "zone") return "zone";
  if (event.t === "finding") return "finding";
  if (event.t === "merged") return "merged";
  if (event.t === "noticed") return "noticed";
  if (event.t === "refused") return "refused";
  return null;
}

export function reduce(state: WalkState, action: Action): WalkState {
  switch (action.type) {
    case "reset":
      return { ...EMPTY, runId: state.runId };
    case "begin":
      return {
        ...EMPTY,
        phase: "loading",
        mode: action.mode,
        startedAt: Date.now(),
        runId: state.runId + 1,
      };
    case "fail":
      return { ...state, phase: "error", error: action.message };
    case "event": {
      const e = action.event;
      // A judged line follows its raw line: mark what became of it.
      const outcome = outcomeOf(e);
      const raw =
        outcome && state.raw.length ? markLast(state.raw, outcome) : state.raw;
      switch (e.t) {
        case "start":
          return {
            ...state,
            phase: "walking",
            model: e.model,
            seconds: e.seconds,
            rules: e.rules,
          };
        case "raw":
          return {
            ...state,
            raw: [
              ...state.raw,
              { line: e.line, outcome: "skipped" as const },
            ].slice(-400),
          };
        case "zone":
          return {
            ...state,
            raw,
            zones: [...state.zones, { at: e.at, zone: e.zone }],
            readHead: Math.max(state.readHead, e.at),
          };
        case "finding":
          return {
            ...state,
            raw,
            findings: [...state.findings, e.finding],
            readHead: Math.max(state.readHead, e.finding.at),
          };
        case "merged":
          return {
            ...state,
            raw,
            findings: state.findings.map((f) =>
              f.id === e.into ? { ...f, alsoAt: [...f.alsoAt, e.at] } : f,
            ),
            readHead: Math.max(state.readHead, e.at),
          };
        case "noticed":
          return {
            ...state,
            raw,
            noticed: [...state.noticed, e.noticed],
            readHead: Math.max(state.readHead, e.noticed.at),
          };
        case "refused":
          return {
            ...state,
            raw,
            refused: [
              ...state.refused,
              { reason: e.reason, sighting: e.sighting },
            ],
          };
        case "done":
          return {
            ...state,
            phase: "done",
            done: { ms: e.ms, usage: e.usage, skipped: e.skipped },
            readHead: state.seconds,
          };
        case "error":
          return { ...state, phase: "error", error: e.message };
      }
    }
  }
  return state;
}

function markLast(raw: RawLine[], outcome: RawLine["outcome"]): RawLine[] {
  const copy = raw.slice();
  for (let i = copy.length - 1; i >= 0; i--) {
    const line = copy[i] as RawLine;
    if (line.outcome === "skipped") {
      copy[i] = { ...line, outcome };
      break;
    }
  }
  return copy;
}

/**
 * Runs a Walk: live (the route streams the Walker's checked lines) or a
 * replay of a recorded real Walk, played at the pace it was recorded.
 */
export function useWalk(onLiveDone?: () => void) {
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const abort = useRef<AbortController | null>(null);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    dispatch({ type: "reset" });
  }, [stop]);

  const replay = useCallback(
    async (slug: string) => {
      stop();
      dispatch({ type: "begin", mode: "replay" });
      const controller = new AbortController();
      abort.current = controller;
      try {
        const response = await fetch(`/floorwalk/samples/${slug}.walk.json`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("No recorded Walk for this Sample yet.");
        const recording = (await response.json()) as Recording;
        for (const { ms, event } of recording.events) {
          timers.current.push(
            window.setTimeout(() => dispatch({ type: "event", event }), ms),
          );
        }
      } catch (error) {
        if (!controller.signal.aborted)
          dispatch({
            type: "fail",
            message:
              error instanceof Error
                ? error.message
                : "The recording could not be played.",
          });
      }
    },
    [stop],
  );

  const live = useCallback(
    async (source: Source) => {
      stop();
      dispatch({ type: "begin", mode: "live" });
      const controller = new AbortController();
      abort.current = controller;
      try {
        await streamWalk(source, controller.signal, (event) =>
          dispatch({ type: "event", event }),
        );
        onLiveDone?.();
      } catch (error) {
        if (!controller.signal.aborted)
          dispatch({
            type: "fail",
            message:
              error instanceof Error ? error.message : "The Walk stopped.",
          });
      }
    },
    [stop, onLiveDone],
  );

  return { state, replay, live, stop, reset };
}
