"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { DemoBar, demoBarControlClass } from "@/components/demo/demo-bar";
import { Badge, Button, cx, ErrorNote } from "@/features/harness/components/ui";
import type { Allowance, Headline, Post } from "../domain/api";
import { injectById } from "../domain/engine";
import { checkRules } from "../domain/rules";
import { Choices, InjectCard, ReadingCard, Whisper } from "./desk";
import { FireMap } from "./fire-map";
import { Lobby } from "./lobby";
import {
  CrisisClock,
  Ledger,
  RoomVoices,
  RulesStrip,
  Ticker,
  Vitals,
} from "./panels";
import { Review } from "./review";
import { UnderTheHood } from "./under-the-hood";
import { useDrill } from "./use-drill";
import "./firebreak.css";

type Tab = "drill" | "hood";

/** How long the recorded drill lets a card sit before it plays an Option. */
const RECORDED_READ_MS = 2600;
const RECORDED_PICK_MS = 1000;

export function Firebreak({
  initialAllowance,
}: {
  initialAllowance: Allowance | null;
}) {
  const [tab, setTab] = useState<Tab>("drill");
  const drill = useDrill(initialAllowance);
  const {
    scenario,
    state,
    phase,
    mode,
    desk,
    live,
    transcripts,
    debrief,
    allowance,
  } = drill;
  const [autoPick, setAutoPick] = useState<string | null>(null);

  const inject = scenario && desk ? (injectById(scenario, desk) ?? null) : null;
  const findings = useMemo(
    () => (scenario && state ? checkRules(scenario, state) : []),
    [scenario, state],
  );
  const last = state?.outcomes[state.outcomes.length - 1] ?? null;
  const transcript = live ?? transcripts[transcripts.length - 1] ?? null;
  const speaking = live?.voices[live.voices.length - 1]?.who ?? null;
  const left = allowance
    ? Math.max(0, allowance.perHour - allowance.used)
    : null;

  const tickerItems = useMemo(
    () =>
      [...transcripts, ...(live ? [live] : [])]
        .flatMap((t) => [
          ...(t.headline
            ? [
                {
                  kind: "headline" as const,
                  item: t.headline as Headline | Post,
                },
              ]
            : []),
          ...t.posts.map((post) => ({
            kind: "post" as const,
            item: post as Headline | Post,
          })),
        ])
        .reverse()
        .slice(0, 12),
    [transcripts, live],
  );

  // The recorded drill plays itself: a card sits long enough to be read, the
  // chosen Option lights up, then it is played.
  const { decide, review } = drill;
  useEffect(() => {
    if (mode !== "recorded" || !scenario || !state) return;
    if (phase === "over") {
      const timer = window.setTimeout(() => void review(), 2200);
      return () => window.clearTimeout(timer);
    }
    if (phase !== "desk" || !inject) return;
    const wanted = scenario.recorded[state.slot];
    const option =
      inject.options.find((o) => o.id === wanted) ?? inject.options[0];
    if (!option) return;
    const light = window.setTimeout(
      () => setAutoPick(option.id),
      RECORDED_READ_MS,
    );
    const play = window.setTimeout(() => {
      setAutoPick(null);
      void decide({ kind: "option", option: option.id });
    }, RECORDED_READ_MS + RECORDED_PICK_MS);
    return () => {
      window.clearTimeout(light);
      window.clearTimeout(play);
    };
  }, [mode, phase, inject, scenario, state, decide, review]);

  const tabs = [
    { id: "drill", label: "Drill", onSelect: () => setTab("drill") },
    { id: "hood", label: "Under the hood", onSelect: () => setTab("hood") },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-marble text-ink">
      <DemoBar
        slug="firebreak"
        name="Firebreak"
        tabs={tabs}
        current={tab}
        panelsId="firebreak"
      >
        {scenario ? (
          <>
            {mode === "recorded" ? (
              <button
                type="button"
                className={cx(demoBarControlClass, "bg-brass")}
                onClick={drill.takeOver}
                disabled={phase === "review" || left === 0}
                data-testid="fb-take-over"
              >
                Take the chair
              </button>
            ) : null}
            <button
              type="button"
              className={demoBarControlClass}
              onClick={drill.leave}
              data-testid="fb-leave"
            >
              Leave drill
            </button>
          </>
        ) : left !== null ? (
          <span className="hidden font-mono text-xs text-ink-muted sm:inline">
            {left} Rounds left this hour
          </span>
        ) : null}
      </DemoBar>

      <main className="flex-1">
        <div
          id="firebreak-panel-drill"
          role="tabpanel"
          aria-labelledby="firebreak-tab-drill"
          hidden={tab !== "drill"}
        >
          <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
            {!scenario || !state ? (
              <Lobby
                onStart={drill.start}
                model={allowance?.model ?? null}
                left={left}
              />
            ) : phase === "review" && debrief ? (
              <Review
                scenario={scenario}
                state={state}
                debrief={debrief}
                onAgain={() => drill.start(scenario.id, mode)}
                onLobby={drill.leave}
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="grid items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                    <CrisisClock
                      scenario={scenario}
                      state={state}
                      findings={findings}
                    />
                    <Vitals scenario={scenario} state={state} />
                  </div>
                  <FireMap
                    scenario={scenario}
                    gauges={state.gauges}
                    round={state.outcomes.length}
                    speaking={speaking}
                    delta={last?.delta ?? null}
                  />
                  <section className="rounded-sm border-2 border-ink bg-limestone/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="eyebrow text-ink-muted">The Room</p>
                      {transcript?.headline ? (
                        <motion.p
                          key={transcript.headline.text}
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="truncate pl-3 text-right text-sm font-bold"
                          data-testid="fb-headline"
                        >
                          <span className="mr-1 font-mono text-[10px] text-seal-red uppercase">
                            {transcript.headline.outlet}
                          </span>
                          {transcript.headline.text}
                        </motion.p>
                      ) : null}
                    </div>
                    {transcript ? (
                      <RoomVoices
                        scenario={scenario}
                        transcript={transcript}
                        thinking={phase === "deciding"}
                      />
                    ) : (
                      <p className="text-sm text-ink-muted">
                        Nobody has said anything yet. They are waiting to hear
                        from you.
                      </p>
                    )}
                  </section>
                </div>

                <aside className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="eyebrow text-ink-muted">
                        {scenario.company} · {scenario.industry}
                      </p>
                      <p className="font-mono text-sm font-bold">
                        Round{" "}
                        {Math.min(
                          state.slot + (phase === "deciding" ? 0 : 1),
                          scenario.slots.length,
                        )}{" "}
                        of {scenario.slots.length}
                      </p>
                    </div>
                    <Badge tone={mode === "recorded" ? "amber" : "blue"}>
                      {mode === "recorded"
                        ? "Recorded · no model"
                        : (allowance?.model ?? "Live")}
                    </Badge>
                  </div>

                  {drill.error ? <ErrorNote>{drill.error}</ErrorNote> : null}

                  <AnimatePresence mode="wait">
                    {phase === "over" ? (
                      <motion.div
                        key="over"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="rounded-sm border-2 border-ink bg-ink p-4 text-paper shadow-hard-md"
                      >
                        <p className="eyebrow text-brass">
                          T+{scenario.hours}h
                        </p>
                        <p className="mt-1 text-2xl font-bold">
                          The clock has run out.
                        </p>
                        <p className="mt-2 text-sm text-limestone">
                          Code will grade the drill. Then the Comms lead drafts
                          what the company says next, and code sends it back
                          until it is fit to publish.
                        </p>
                        <Button
                          className="mt-3"
                          variant="primary"
                          onClick={() => void drill.review()}
                          data-testid="fb-review-start"
                        >
                          Open the After-Action Review
                        </Button>
                      </motion.div>
                    ) : inject ? (
                      <InjectCard
                        key={inject.id}
                        scenario={scenario}
                        inject={inject}
                        hour={scenario.slots[state.slot] ?? state.hour}
                      />
                    ) : null}
                  </AnimatePresence>

                  {live?.reading ? (
                    <ReadingCard scenario={scenario} reading={live.reading} />
                  ) : null}

                  {phase === "desk" && inject ? (
                    <Choices
                      key={inject.id}
                      scenario={scenario}
                      inject={inject}
                      taken={state.taken}
                      disabled={mode === "recorded"}
                      autoPick={autoPick}
                      onDecide={(choice) => void decide(choice)}
                    />
                  ) : null}

                  {phase === "deciding" &&
                  last &&
                  live &&
                  state.outcomes.length > transcripts.length ? (
                    <div>
                      <p className="eyebrow mb-1.5 text-ink-muted">
                        What code did with it
                      </p>
                      <Ledger outcome={last} />
                    </div>
                  ) : phase === "deciding" ? (
                    <p className="text-sm text-ink-muted">Playing the Round…</p>
                  ) : null}

                  {transcript?.whisper && phase !== "deciding" ? (
                    <Whisper text={transcript.whisper} />
                  ) : null}

                  <details
                    className="rounded-sm border-2 border-ink bg-paper p-3"
                    open
                  >
                    <summary className="eyebrow cursor-pointer text-ink-muted">
                      The Rulebook · checked by code
                    </summary>
                    <div className="mt-2">
                      <RulesStrip findings={findings} />
                    </div>
                  </details>
                  {phase !== "deciding" && last ? (
                    <details className="rounded-sm border-2 border-ink bg-paper p-3">
                      <summary className="eyebrow cursor-pointer text-ink-muted">
                        Last Round, step by step
                      </summary>
                      <div className="mt-2">
                        <Ledger outcome={last} />
                      </div>
                    </details>
                  ) : null}
                </aside>
              </div>
            )}
          </div>
        </div>
        <div
          id="firebreak-panel-hood"
          role="tabpanel"
          aria-labelledby="firebreak-tab-hood"
          hidden={tab !== "hood"}
        >
          <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
            <UnderTheHood
              scenario={scenario}
              usage={drill.usage}
              model={allowance?.model ?? "Qwen4-Max"}
            />
          </div>
        </div>
      </main>

      {scenario && tab === "drill" && phase !== "review" ? (
        <div className="sticky bottom-0 z-20">
          <Ticker items={tickerItems} />
        </div>
      ) : null}
    </div>
  );
}
