"use client";

import { useMotionValue, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Replay } from "../domain/contract";
import {
  emptyRunView,
  type RunView,
  reduceRunView,
  type SeqEvent,
} from "./run-view";

export const SPEEDS = [10, 20, 40] as const;
const READING_PACE = 0.2;
const QUIET_PACE = 1.6;
export type Speed = (typeof SPEEDS)[number];

export type ReplayState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; replay: Replay };

/** The first of `paths` that is shipped, or "missing" when none is yet. */
export function useReplayFile(paths: string[]): ReplayState {
  const [state, setState] = useState<ReplayState>(
    paths.length ? { kind: "loading" } : { kind: "missing" },
  );
  const key = paths.join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `paths`
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for (const path of paths) {
        try {
          const response = await fetch(path, { signal: controller.signal });
          if (!response.ok) continue;
          const replay = (await response.json()) as Replay;
          if (!Array.isArray(replay.events)) continue;
          setState({ kind: "ready", replay });
          return;
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      setState({ kind: "missing" });
    })();
    return () => controller.abort();
  }, [key]);
  return state;
}

/**
 * Plays a recorded Run through the same fold as a live one, sped up. The
 * clock is a motion value, so the time ticks without re-rendering; the view
 * re-renders only when events land. Under reduced motion it opens at the end.
 */
export function useReplayPlayer(replay: Replay | null, active: boolean) {
  const reduce = useReducedMotion();
  const clock = useMotionValue(0);
  const [view, setView] = useState<RunView>(emptyRunView);
  const [speed, setSpeed] = useState<Speed>(20);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);
  const cursor = useRef({ index: 0, virtual: 0, view: emptyRunView });

  const events = useRef<SeqEvent[]>([]);
  const origin = useRef(0);
  useEffect(() => {
    if (!replay) return;
    events.current = replay.events
      .slice()
      .sort((a, b) => a.at - b.at || a.seq - b.seq);
    origin.current = events.current[0]?.at ?? 0;
  }, [replay]);

  const finish = useCallback(() => {
    if (!replay) return;
    let next = cursor.current.view;
    for (const event of events.current.slice(cursor.current.index))
      next = reduceRunView(next, event);
    // The recorded Register is the last word on the names.
    next = { ...next, names: replay.names.length ? replay.names : next.names };
    cursor.current = {
      index: events.current.length,
      virtual: replay.durationMs,
      view: next,
    };
    clock.set(replay.durationMs);
    setView(next);
    setPlaying(false);
    setDone(true);
  }, [replay, clock]);

  const restart = useCallback(() => {
    cursor.current = { index: 0, virtual: 0, view: emptyRunView };
    clock.set(0);
    setView(emptyRunView);
    setDone(false);
    setPlaying(true);
  }, [clock]);

  // Starts once, the first time the stage is on screen.
  useEffect(() => {
    if (!replay || !active || started.current) return;
    started.current = true;
    if (reduce) finish();
    else restart();
  }, [replay, active, reduce, finish, restart]);

  useEffect(() => {
    if (!playing || !replay) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const state = cursor.current;
      // Slow down while readers sweep the pages (the part worth watching),
      // hurry through the stretches where the lead agent only thinks. The
      // clock still shows the recorded time.
      const reading = state.view.readers.some((item) => item.state === "start");
      const step =
        Math.min(now - last, 100) *
        speed *
        (reading ? READING_PACE : QUIET_PACE);
      last = now;
      state.virtual = Math.min(replay.durationMs, state.virtual + step);
      let next = state.view;
      const list = events.current;
      while (
        state.index < list.length &&
        list[state.index].at - origin.current <= state.virtual
      ) {
        next = reduceRunView(next, list[state.index]);
        state.index++;
      }
      clock.set(state.virtual);
      if (next !== state.view) {
        state.view = next;
        setView(next);
      }
      if (state.virtual >= replay.durationMs) {
        finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, replay, speed, clock, finish]);

  return {
    view,
    clock,
    speed,
    setSpeed,
    playing,
    done,
    pause: () => setPlaying(false),
    resume: () => {
      if (done) restart();
      else setPlaying(true);
    },
    restart,
    skip: finish,
  };
}
