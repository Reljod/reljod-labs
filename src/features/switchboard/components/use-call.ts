"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CallEvent,
  CallView,
  ReportedEvent,
  Scenario,
} from "../domain/contract";
import { detectLanguage } from "../domain/hearing";
import { addUsage, type RealtimeUsage, realtimeCost } from "../domain/models";
import { sampleCaller } from "../domain/samples";
import {
  callerItem,
  type Item,
  itemOf,
  itemsOf,
  localId,
} from "../domain/transcript";
import { api, messageOf } from "./api";
import { VoiceSession } from "./voice-session";

export type Phase = "idle" | "connecting" | "live" | "wrapping" | "done";

export type LogEntry = { ms: number; type: string; note?: string };

export type CallState = {
  phase: Phase;
  call: CallView | null;
  /** The saved Events, once the server has them (always, on the text Line). */
  events: CallEvent[];
  items: Item[];
  speaking: "caller" | "agent" | null;
  toolBusy: string | null;
  mic: "on" | "refused" | "off";
  log: LogEntry[];
  usage: RealtimeUsage;
  costUsd: number;
  sampleLine: number | null;
  error: string | null;
  /** The Agent is working on a typed Turn. */
  thinking: boolean;
};

const EMPTY: CallState = {
  phase: "idle",
  call: null,
  events: [],
  items: [],
  speaking: null,
  toolBusy: null,
  mic: "off",
  log: [],
  usage: {},
  costUsd: 0,
  sampleLine: null,
  error: null,
  thinking: false,
};

const LOG_KEPT = 400;

/**
 * One Call on the screen, on either Line. The voice Line runs in a
 * `VoiceSession`; the text Line is a Turn at a time over the turns route.
 * Either way the transcript is a list of `Item`s and the Call ends in the
 * same Wrap-up.
 */
export function useCall(onChanged: () => void) {
  const [state, setState] = useState<CallState>(EMPTY);
  const session = useRef<VoiceSession | null>(null);
  const live = useRef<CallView | null>(null);
  const queue = useRef<ReportedEvent[]>([]);
  const flushing = useRef<Promise<void>>(Promise.resolve());
  const ending = useRef(false);
  const dropped = useRef(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const patch = useCallback(
    (next: Partial<CallState> | ((current: CallState) => Partial<CallState>)) =>
      setState((current) => ({
        ...current,
        ...(typeof next === "function" ? next(current) : next),
      })),
    [],
  );

  const flush = useCallback(() => {
    const call = live.current;
    if (!call || queue.current.length === 0) return flushing.current;
    const batch = queue.current.splice(0, 40);
    flushing.current = flushing.current
      .then(() => api.report(call.id, batch))
      .then((result) => {
        patch({ costUsd: result.costUsd });
        if (result.status !== "live" && !ending.current)
          void hangUpRef.current("server");
      })
      .catch(() => {
        dropped.current += batch.length;
      });
    return flushing.current;
  }, [patch]);

  useEffect(() => {
    const timer = setInterval(() => void flush(), 1000);
    return () => clearInterval(timer);
  }, [flush]);

  /** After the hang-up: wait for the Workflow's Wrap-up. */
  const awaitWrapup = useCallback(
    async (id: string) => {
      for (let tries = 0; tries < 60; tries++) {
        try {
          const loaded = await api.call(id);
          patch({
            call: loaded.call,
            events: loaded.events,
            items: itemsOf(loaded.events),
          });
          if (
            loaded.call.wrapupStatus === "done" ||
            loaded.call.wrapupStatus === "failed"
          )
            break;
        } catch {
          // Try again.
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      patch({ phase: "done" });
      changed.current();
    },
    [patch],
  );

  const hangUp = useCallback(
    async (_by: "caller" | "server" = "caller") => {
      const call = live.current;
      if (!call || ending.current) return;
      ending.current = true;
      const voice = session.current;
      session.current = null;
      if (voice) {
        const stats = voice.stats();
        voice.close();
        const entries = stateRef.current.log.slice(-LOG_KEPT);
        queue.current.push({
          type: "session.log",
          entries,
          ...stats,
          dropped: dropped.current,
        });
      }
      patch({
        phase: "wrapping",
        speaking: null,
        toolBusy: null,
        sampleLine: null,
        thinking: false,
      });
      while (queue.current.length > 0) await flush();
      await flushing.current;
      try {
        await api.end(call.id);
      } catch {
        // Already over on the server.
      }
      live.current = null;
      changed.current();
      await awaitWrapup(call.id);
    },
    [awaitWrapup, flush, patch],
  );
  const hangUpRef = useRef(hangUp);
  hangUpRef.current = hangUp;
  const stateRef = useRef(state);
  stateRef.current = state;

  // The server's clock decides; the browser hangs up at the same moment.
  useEffect(() => {
    if (state.phase !== "live" || !state.call) return;
    const ms = Date.parse(state.call.deadlineAt) - Date.now();
    const timer = setTimeout(
      () => void hangUpRef.current("server"),
      Math.max(0, ms),
    );
    return () => clearTimeout(timer);
  }, [state.phase, state.call]);

  // Leaving the page hangs up.
  useEffect(
    () => () => {
      session.current?.close();
      if (live.current) void api.end(live.current.id).catch(() => {});
    },
    [],
  );

  const begin = useCallback(() => {
    ending.current = false;
    dropped.current = 0;
    queue.current = [];
    setState({ ...EMPTY, phase: "connecting" });
  }, []);

  const startVoice = useCallback(
    async (input: { model?: string; scenario: Scenario; mic: boolean }) => {
      if (live.current || stateRef.current.phase === "connecting") return;
      begin();
      try {
        const started = await api.start({
          line: "voice",
          model: input.model,
          scenario: input.scenario,
        });
        if (!started.session) throw new Error("The voice Line did not open.");
        live.current = started.call;
        const model = started.call.model;
        const sample =
          input.scenario.kind === "sample"
            ? (sampleCaller(input.scenario.sampleId) ?? null)
            : null;
        const push = (item: Item) =>
          patch((current) => ({
            items: [
              ...current.items.filter(
                (old) => !(old.kind === "agent" && old.partial),
              ),
              item,
            ],
          }));
        const voice = new VoiceSession(
          started.session,
          {
            onCaller: (text, via) => push(callerItem(text, via)),
            onAgentPartial: (text) =>
              patch((current) => ({
                items: [
                  ...current.items.filter(
                    (old) => !(old.kind === "agent" && old.partial),
                  ),
                  {
                    kind: "agent",
                    id: "partial",
                    text,
                    language: detectLanguage(text),
                    interrupted: false,
                    partial: true,
                  },
                ],
              })),
            onAgentTurn: (turn) =>
              push({
                kind: "agent",
                id: localId(),
                text: turn.text,
                language: detectLanguage(turn.text),
                interrupted: turn.interrupted,
                latency: turn.latency,
              }),
            onBargeIn: (playedMs) =>
              push({
                kind: "note",
                id: localId(),
                tone: "barge",
                text: `Barge-in: the Caller cut the Agent off after ${(playedMs / 1000).toFixed(1)} s`,
              }),
            onTool: (name, phase, response) => {
              if (phase === "start") return patch({ toolBusy: name });
              patch((current) => ({
                toolBusy: null,
                events: [...current.events, ...(response?.events ?? [])],
                items: [
                  ...current.items,
                  ...(response?.events ?? []).flatMap(
                    (event) => itemOf(event) ?? [],
                  ),
                ],
              }));
              if (
                response?.events.some((event) => event.type === "tool.result")
              )
                changed.current();
            },
            onSpeaking: (who) => patch({ speaking: who }),
            onLog: (entry) =>
              patch((current) => ({
                log: [...current.log, entry].slice(-LOG_KEPT),
              })),
            onUsage: (usage) =>
              patch((current) => ({
                usage: addUsage(current.usage, usage),
                costUsd: current.costUsd + realtimeCost(model, usage),
              })),
            onSampleLine: (index) => patch({ sampleLine: index }),
            onError: (message) => patch({ error: message }),
            onOver: () => void hangUpRef.current("caller"),
            callTool: (body) => api.tool(started.call.id, body),
            report: (events) => {
              queue.current.push(...events);
            },
          },
          sample,
        );
        session.current = voice;
        const opened = await voice.open(input.mic);
        queue.current.push({
          type: "session.opened",
          mintMs: started.session.mintMs,
          connectMs: opened.connectMs,
        });
        patch({
          phase: "live",
          call: started.call,
          events: started.events,
          mic: opened.mic,
        });
      } catch (error) {
        session.current?.close();
        session.current = null;
        const call = live.current;
        live.current = null;
        if (call) void api.end(call.id).catch(() => {});
        setState({ ...EMPTY, error: messageOf(error) });
      }
    },
    [patch, begin],
  );

  const startText = useCallback(
    async (scenario: Scenario) => {
      if (live.current || stateRef.current.phase === "connecting") return;
      begin();
      try {
        const started = await api.start({ line: "text", scenario });
        live.current = started.call;
        patch({
          phase: "live",
          call: started.call,
          events: started.events,
          items: itemsOf(started.events),
        });
      } catch (error) {
        setState({ ...EMPTY, error: messageOf(error) });
      }
    },
    [patch, begin],
  );

  /** A typed Turn: into the voice Session when one is open, else the text Line. */
  const say = useCallback(
    async (text: string) => {
      const call = live.current;
      if (!call || !text.trim()) return;
      if (session.current) return session.current.say(text.trim());
      patch((current) => ({
        thinking: true,
        error: null,
        items: [...current.items, callerItem(text.trim(), "text")],
      }));
      let partial = "";
      try {
        await api.turn(call.id, text.trim(), (part) => {
          if (part.kind === "delta") {
            partial += part.text;
            const said = partial;
            patch((current) => ({
              items: [
                ...current.items.filter(
                  (old) => !(old.kind === "agent" && old.partial),
                ),
                {
                  kind: "agent",
                  id: "partial",
                  text: said,
                  language: detectLanguage(said),
                  interrupted: false,
                  partial: true,
                },
              ],
            }));
          } else if (part.kind === "event") {
            const event = part.event;
            if (event.type === "tool.called")
              patch({ toolBusy: event.data.name });
            if (event.type === "tool.result") {
              patch({ toolBusy: null });
              changed.current();
            }
            patch((current) => {
              const events = [...current.events, event];
              return {
                events,
                // Keep what is still being said below the saved Events.
                items: [
                  ...itemsOf(events),
                  ...current.items.filter(
                    (old) =>
                      old.kind === "agent" &&
                      old.partial &&
                      event.type !== "turn.agent",
                  ),
                ],
              };
            });
          } else if (part.kind === "call") {
            patch({ call: part.call, costUsd: part.call.costUsd });
            if (part.call.status !== "live") void hangUpRef.current("server");
          } else if (part.kind === "error") patch({ error: part.message });
        });
      } catch (error) {
        patch({ error: messageOf(error) });
      } finally {
        patch((current) => ({
          thinking: false,
          toolBusy: null,
          items: itemsOf(current.events),
        }));
      }
    },
    [patch],
  );

  /** Opens a saved Call in the same view. */
  const open = useCallback(
    async (id: string) => {
      if (live.current) return;
      try {
        const loaded = await api.call(id);
        setState({
          ...EMPTY,
          phase: "done",
          call: loaded.call,
          events: loaded.events,
          items: itemsOf(loaded.events),
          usage: loaded.call.usage,
          costUsd: loaded.call.costUsd,
          log:
            loaded.events.flatMap((event) =>
              event.type === "session.log" ? event.data.entries : [],
            ) ?? [],
        });
      } catch (error) {
        patch({ error: messageOf(error) });
      }
    },
    [patch],
  );

  const reset = useCallback(() => {
    if (!live.current) setState(EMPTY);
  }, []);

  const refresh = useCallback(async () => {
    const call = stateRef.current.call;
    if (!call || live.current) return;
    await open(call.id);
  }, [open]);

  const levels = useCallback(
    () => session.current?.levels() ?? { caller: 0, agent: 0 },
    [],
  );

  return {
    state,
    startVoice,
    startText,
    say,
    hangUp,
    open,
    reset,
    refresh,
    levels,
  };
}

export type CallController = ReturnType<typeof useCall>;
