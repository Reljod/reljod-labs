"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Allowance,
  DebriefEvent,
  Echo,
  Headline,
  Post,
  TurnEvent,
  Usage,
  Voice,
} from "../domain/api";
import type { Reading } from "../domain/brief";
import {
  type Choice,
  type DrillState,
  eligibleInjects,
  initialState,
  play,
  type Round,
} from "../domain/engine";
import type { Scorecard } from "../domain/review";
import type { Scenario } from "../domain/scenario";
import { scenarioById } from "../domain/scenarios";
import type { StatementNote } from "../domain/statement";
import { api } from "./api";
import { recordedDebrief, recordedTurn } from "./recorded";

/** What the Room said in one Round. */
export type Transcript = {
  reading: Reading | null;
  voices: Voice[];
  headline: Headline | null;
  posts: Post[];
  whisper: string | null;
};

export type Draft = {
  n: number;
  text: string;
  notes: StatementNote[] | null;
  passed: boolean;
};

export type Debrief = {
  scorecard: Scorecard | null;
  lessons: string[];
  drafts: Draft[];
  done: boolean;
  passed: boolean;
};

/**
 * lobby: choosing a company. desk: an Inject waits for a decision. deciding:
 * the Round is being played and the Room is talking. over: the clock has run
 * out. review: the After-Action Review.
 */
export type Phase = "lobby" | "desk" | "deciding" | "over" | "review";
export type Mode = "live" | "recorded";

const emptyTranscript = (): Transcript => ({
  reading: null,
  voices: [],
  headline: null,
  posts: [],
  whisper: null,
});

/** The Room's earlier lines, sent back so the next Round remembers them. */
export function echoesOf(
  scenario: Scenario,
  transcripts: Transcript[],
): Echo[] {
  return transcripts.map((transcript) => ({
    headline: transcript.headline
      ? `${transcript.headline.outlet}: ${transcript.headline.text}`
      : "",
    lines: transcript.voices.slice(0, 4).map((voice) => {
      const who = scenario.stakeholders.find((s) => s.gauge === voice.who);
      return `${who?.name ?? voice.who}: ${voice.line}`.slice(0, 300);
    }),
  }));
}

export function useDrill(initialAllowance: Allowance | null) {
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("live");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [live, setLive] = useState<Transcript | null>(null);
  const [desk, setDesk] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [allowance, setAllowance] = useState<Allowance | null>(
    initialAllowance,
  );
  const abort = useRef<AbortController | null>(null);

  const scenario = scenarioId ? (scenarioById(scenarioId) ?? null) : null;
  const state: DrillState | null = useMemo(
    () => (scenario ? play(scenario, rounds) : null),
    [scenario, rounds],
  );

  useEffect(() => () => abort.current?.abort(), []);

  const refreshAllowance = useCallback(() => {
    api
      .allowance()
      .then(setAllowance)
      .catch(() => {});
  }, []);

  const start = useCallback((id: string, how: Mode) => {
    const next = scenarioById(id);
    if (!next) return;
    abort.current?.abort();
    setScenarioId(id);
    setMode(how);
    setRounds([]);
    setTranscripts([]);
    setLive(null);
    setUsage([]);
    setError(null);
    setDebrief(null);
    setDesk(eligibleInjects(next, initialState(next))[0]?.id ?? null);
    setPhase("desk");
  }, []);

  const leave = useCallback(() => {
    abort.current?.abort();
    setScenarioId(null);
    setPhase("lobby");
    setDebrief(null);
    setLive(null);
  }, []);

  /** From the recorded drill, carry on live from where it is. */
  const takeOver = useCallback(() => setMode("live"), []);

  const decide = useCallback(
    async (choice: Choice) => {
      if (!scenario || !state || !desk || phase !== "desk") return;
      const controller = new AbortController();
      abort.current?.abort();
      abort.current = controller;
      const current = { inject: desk, choice };
      const transcript = emptyTranscript();
      let played: Round | null = null as Round | null;
      let next: string | null = null;
      setError(null);
      setLive(transcript);
      setPhase("deciding");
      const events: AsyncGenerator<TurnEvent> =
        mode === "recorded"
          ? recordedTurn(scenario, state, current, controller.signal)
          : api.turn(
              {
                scenario: scenario.id,
                rounds,
                echoes: echoesOf(scenario, transcripts),
                current,
              },
              controller.signal,
            );
      const update = (change: Partial<Transcript>) => {
        Object.assign(transcript, change);
        setLive({ ...transcript });
      };
      try {
        for await (const event of events) {
          if (event.t === "reading") {
            update({
              reading: {
                heard: event.heard,
                levers: event.levers,
                outside: event.outside,
              },
            });
          } else if (event.t === "outcome") {
            const round: Round = { ...current, levers: event.levers };
            played = round;
            setRounds((list) => [...list, round]);
          } else if (event.t === "voice") {
            update({ voices: [...transcript.voices, event.voice] });
          } else if (event.t === "headline") {
            update({ headline: event.headline });
          } else if (event.t === "post") {
            update({ posts: [...transcript.posts, event.post] });
          } else if (event.t === "whisper") {
            update({ whisper: event.text });
          } else if (event.t === "next") {
            next = event.inject;
          } else if (event.t === "usage") {
            setUsage((list) => [...list, event.usage]);
          } else if (event.t === "error") {
            setError(event.message);
          }
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error ? caught.message : "The Room went quiet.",
        );
      }
      if (controller.signal.aborted) return;
      if (!played) {
        // Nothing was decided: the same card stays on the desk.
        setLive(null);
        setPhase("desk");
        return;
      }
      setTranscripts((list) => [...list, { ...transcript }]);
      setLive(null);
      const after = play(scenario, [...rounds, played]);
      const allowed = eligibleInjects(scenario, after).map((i) => i.id);
      const landing =
        next && allowed.includes(next) ? next : (allowed[0] ?? null);
      setDesk(landing);
      setPhase(after.done ? "over" : "desk");
      if (mode === "live") refreshAllowance();
    },
    [scenario, state, desk, phase, mode, rounds, transcripts, refreshAllowance],
  );

  const review = useCallback(async () => {
    if (!scenario || !state || !state.done) return;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    const result: Debrief = {
      scorecard: null,
      lessons: [],
      drafts: [],
      done: false,
      passed: false,
    };
    setDebrief({ ...result });
    setError(null);
    setPhase("review");
    const events: AsyncGenerator<DebriefEvent> =
      mode === "recorded"
        ? recordedDebrief(scenario, state, controller.signal)
        : api.debrief(
            {
              scenario: scenario.id,
              rounds,
              echoes: echoesOf(scenario, transcripts),
            },
            controller.signal,
          );
    const publish = () =>
      setDebrief({ ...result, drafts: result.drafts.map((d) => ({ ...d })) });
    try {
      for await (const event of events) {
        if (event.t === "scorecard") result.scorecard = event.scorecard;
        else if (event.t === "lessons") result.lessons = event.lessons;
        else if (event.t === "draft")
          result.drafts.push({
            n: event.n,
            text: event.text,
            notes: null,
            passed: false,
          });
        else if (event.t === "notes") {
          const draft = result.drafts.find((d) => d.n === event.n);
          if (draft) {
            draft.notes = event.notes;
            draft.passed = event.passed;
          }
        } else if (event.t === "usage")
          setUsage((list) => [...list, event.usage]);
        else if (event.t === "done") {
          result.done = true;
          result.passed = event.passed;
        } else if (event.t === "error") setError(event.message);
        publish();
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof Error ? caught.message : "The Review stopped.",
      );
    }
    result.done = true;
    publish();
  }, [scenario, state, mode, rounds, transcripts]);

  return {
    scenario,
    state,
    mode,
    phase,
    rounds,
    transcripts,
    live,
    desk,
    usage,
    error,
    debrief,
    allowance,
    start,
    leave,
    takeOver,
    decide,
    review,
  };
}

export type Drill = ReturnType<typeof useDrill>;
