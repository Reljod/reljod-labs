"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Allowance,
  PassEvent,
  PassRequest,
  PassUsage,
} from "../domain/api";
import type { Drawing, Mark, Swatch, TypeStep } from "../domain/drawing";
import type { Measurement } from "../domain/ruler";
import {
  DEFAULT_RULEBOOK,
  type Rulebook,
  wantsAnotherPass,
} from "../domain/rules";
import { ApiError, getAllowance, streamPass } from "./api";
import {
  measureDrawing,
  notesFrom,
  prepareScreenshot,
  renderingOf,
  type Screenshot,
} from "./raster";

export type Phase =
  | "idle"
  | "preparing"
  | "reading"
  | "drawing"
  | "measuring"
  | "done"
  | "error";

export type PassRecord = {
  pass: number;
  drawing: Drawing;
  /** Null while the Ruler is still measuring. */
  measurement: Measurement | null;
  usage: PassUsage;
  model: string;
};

/** The Pass being drawn right now, as its events arrive. */
export type LivePass = {
  pass: number;
  model: string;
  palette: Swatch[];
  typeScale: TypeStep[];
  background: string | null;
  marks: Mark[];
  startedAt: number;
};

export type Source = { id: string; label: string; src: string };

export type StopReason = "target" | "passes" | "stopped" | "allowance" | null;

export type TraceState = {
  phase: Phase;
  source: Source | null;
  shot: Screenshot | null;
  passes: PassRecord[];
  live: LivePass | null;
  error: string | null;
  stopReason: StopReason;
};

const IDLE: TraceState = {
  phase: "idle",
  source: null,
  shot: null,
  passes: [],
  live: null,
  error: null,
  stopReason: null,
};

/** The Ruler's sweep plays at least this long, so a fast measure still reads as one. */
const MEASURE_SHOW_MS = 1400;
/** Then the heat map blooms and the stamp lands before anything moves on. */
const HEAT_SHOW_MS = 2200;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The Trace loop: prepare the screenshot, then Pass after Pass until a Rule
 * says stop. Streamed events are applied at most once per animation frame.
 */
export function useTrace(initialAllowance: Allowance | null) {
  const [state, setState] = useState<TraceState>(IDLE);
  const [rulebook, setRulebook] = useState<Rulebook>(DEFAULT_RULEBOOK);
  const [allowance, setAllowance] = useState<Allowance | null>(
    initialAllowance,
  );
  const controller = useRef<AbortController | null>(null);
  const rulebookRef = useRef(rulebook);
  rulebookRef.current = rulebook;
  const allowanceRef = useRef(allowance);
  allowanceRef.current = allowance;

  useEffect(() => {
    if (initialAllowance) return;
    const abort = new AbortController();
    getAllowance(abort.signal)
      .then(setAllowance)
      .catch(() => {});
    return () => abort.abort();
  }, [initialAllowance]);

  useEffect(() => () => controller.current?.abort(), []);

  const runPass = useCallback(
    async (
      request: PassRequest,
      signal: AbortSignal,
    ): Promise<{ drawing: Drawing; usage: PassUsage; model: string }> => {
      let pending: PassEvent[] = [];
      let frame = 0;
      const flush = () => {
        frame = 0;
        const events = pending;
        pending = [];
        if (events.length === 0) return;
        setState((current) => {
          if (!current.live) return current;
          const live = { ...current.live };
          let phase = current.phase;
          for (const event of events) {
            if (event.t === "swatch")
              live.palette = [...live.palette, event.swatch];
            else if (event.t === "type")
              live.typeScale = [...live.typeScale, event.step];
            else if (event.t === "background") live.background = event.hex;
            else if (event.t === "mark") {
              live.marks = [...live.marks, event.mark];
              phase = "drawing";
            }
          }
          return { ...current, live, phase };
        });
      };

      setState((current) => ({
        ...current,
        phase: "reading",
        live: {
          pass: request.pass,
          model: "",
          palette: [],
          typeScale: [],
          background: null,
          marks: [],
          startedAt: Date.now(),
        },
      }));
      setAllowance(
        (current) => current && { ...current, used: current.used + 1 },
      );

      let done: Extract<PassEvent, { t: "done" }> | null = null;
      let model = "";
      try {
        for await (const event of streamPass(request, signal)) {
          if (event.t === "start") {
            model = event.model;
            setState((current) =>
              current.live
                ? { ...current, live: { ...current.live, model } }
                : current,
            );
          } else if (event.t === "error") throw new Error(event.message);
          else if (event.t === "done") done = event;
          else {
            pending.push(event);
            frame ||= requestAnimationFrame(flush);
          }
        }
      } finally {
        if (frame) cancelAnimationFrame(frame);
        flush();
      }
      if (!done)
        throw new Error("The Pass ended before the Drawing was finished.");
      return { drawing: done.drawing, usage: done.usage, model };
    },
    [],
  );

  const trace = useCallback(
    async (source: Source) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const { signal } = abort;
      setState({ ...IDLE, phase: "preparing", source });
      try {
        const shot = await prepareScreenshot(source.src);
        if (signal.aborted) return;
        setState((current) => ({ ...current, shot }));

        const passes: PassRecord[] = [];
        let request: PassRequest = {
          pass: 1,
          width: shot.width,
          height: shot.height,
          screenshot: shot.screenshot,
          squared: shot.squared,
        };
        while (true) {
          const left = allowanceRef.current
            ? allowanceRef.current.perHour - allowanceRef.current.used
            : 1;
          if (left <= 0) {
            setState((current) => ({
              ...current,
              phase: "done",
              live: null,
              stopReason: "allowance",
            }));
            return;
          }
          const { drawing, usage, model } = await runPass(request, signal);
          if (signal.aborted) return;
          // The finished Drawing goes on the Sheet while the Ruler sweeps it.
          passes.push({
            pass: request.pass,
            drawing,
            measurement: null,
            usage,
            model,
          });
          setState((current) => ({
            ...current,
            passes: [...passes],
            live: null,
            phase: "measuring",
          }));
          const [measurement] = await Promise.all([
            measureDrawing(drawing, shot.pixels),
            wait(MEASURE_SHOW_MS),
          ]);
          if (signal.aborted) return;
          passes[passes.length - 1] = {
            pass: request.pass,
            drawing,
            measurement,
            usage,
            model,
          };
          setState((current) => ({ ...current, passes: [...passes] }));
          // Let the heat bloom and the score land.
          await wait(HEAT_SHOW_MS);
          if (signal.aborted) return;
          const rules = rulebookRef.current;
          const again = wantsAnotherPass(
            rules,
            passes.length,
            measurement.likeness,
          );
          if (!again) {
            setState((current) => ({
              ...current,
              phase: "done",
              stopReason:
                measurement.likeness >= rules.target ? "target" : "passes",
            }));
            return;
          }
          request = {
            pass: request.pass + 1,
            width: shot.width,
            height: shot.height,
            screenshot: shot.screenshot,
            squared: shot.squared,
            previous: drawing,
            rendering: await renderingOf(drawing, shot.width),
            likeness: Math.round(measurement.likeness * 1000) / 1000,
            notes: notesFrom(measurement, rules.target),
          };
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ApiError && error.status === 429)
          setAllowance(
            (current) => current && { ...current, used: current.perHour },
          );
        setState((current) => ({
          ...current,
          phase: current.passes.length > 0 ? "done" : "error",
          live: null,
          error:
            error instanceof Error ? error.message : "Something went wrong.",
        }));
      }
    },
    [runPass],
  );

  const stop = useCallback(() => {
    controller.current?.abort();
    setState((current) =>
      current.phase === "idle" ||
      current.phase === "done" ||
      current.phase === "error"
        ? current
        : {
            ...current,
            phase: current.passes.length > 0 ? "done" : "idle",
            live: null,
            stopReason: "stopped",
          },
    );
  }, []);

  return { state, trace, stop, rulebook, setRulebook, allowance };
}
