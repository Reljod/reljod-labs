"use client";

import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Replay } from "../domain/contract";
import { REPLAYS } from "../server/replays";
import { clockText, usd } from "./format";
import { SOFT, SPRING } from "./motion-kit";
import { plural } from "./plain";
import { RunStage } from "./run-stage";
import { emptyRunView } from "./run-view";
import { cx } from "./ui";
import { SPEEDS, useReplayFile, useReplayPlayer } from "./use-replay";

const REPLAY_PATHS = REPLAYS.map((item) => item.path);

/** A replay control: the bar's box and press, smaller. */
const control =
  "outline-box press eyebrow inline-flex h-8 items-center justify-center gap-1.5 rounded-sm px-2.5 font-bold";

function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setSeen(true);
      },
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

/** The moment the replay lands: the score, what it cost, where to go next. */
function EndMoment({
  replay,
  onCompare,
  onTry,
  onUpload,
  onReplay,
  onHide,
}: {
  replay: Replay;
  onCompare: () => void;
  onTry: () => void;
  onUpload: () => void;
  onReplay: () => void;
  onHide: () => void;
}) {
  const score = replay.comparison.score;
  const found = score?.truePositives ?? replay.names.length;
  const expected = score?.expected ?? replay.names.length;
  const extras = score ? Math.max(0, score.found - score.truePositives) : 0;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-10 flex items-start justify-center bg-ink/80 p-4 pt-16 sm:pt-24"
    >
      <motion.div
        role="status"
        initial={{ scale: 0.92, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ ...SPRING, delay: 0.1 }}
        className="outline-box relative flex w-full max-w-xl flex-col items-center gap-4 rounded-sm bg-paper px-5 py-7 text-center text-ink shadow-[8px_8px_0_var(--color-brass)] sm:px-8"
      >
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide the summary and look at the map"
          className={cx(control, "absolute top-3 right-3 size-8 bg-paper px-0")}
        >
          ×
        </button>
        <span className="eyebrow text-[0.65rem] text-ivy">● Finished</span>
        <p className="font-mono text-3xl leading-tight font-bold uppercase sm:text-[2.6rem]">
          Found{" "}
          <span className="text-ivy">
            {found} of {expected}
          </span>{" "}
          names
        </p>
        <p className="text-[0.95rem] text-ink-muted">
          in a {replay.pages.toLocaleString("en-US")}-page{" "}
          {replay.genre.toLowerCase()} ·{" "}
          <strong className="text-ink">{usd(replay.costUsd)}</strong> ·{" "}
          <strong className="text-ink">{clockText(replay.durationMs)}</strong>
          {extras > 0 ? (
            <>
              {" "}
              ·{" "}
              <span className="text-oak">
                {plural(extras, "extra")} to review
              </span>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onCompare}
            className="outline-box press inline-flex h-10 items-center gap-2 rounded-sm bg-brass px-4 font-mono text-xs font-bold uppercase"
          >
            See it side by side →
          </button>
          <button
            type="button"
            onClick={onTry}
            className="outline-box press inline-flex h-10 items-center rounded-sm bg-paper px-4 font-mono text-xs font-bold uppercase"
          >
            Try a document
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="outline-box press inline-flex h-10 items-center rounded-sm bg-paper px-4 font-mono text-xs font-bold text-federal-blue uppercase"
          >
            Upload a PDF
          </button>
        </div>
        <button
          type="button"
          onClick={onReplay}
          className="eyebrow text-ink-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-federal-blue"
        >
          ↻ Watch again
        </button>
      </motion.div>
    </motion.div>
  );
}

/**
 * The first thing on the page: a real Run, recorded, played back sped up.
 * No explanation; the counters, the page map and the names say it.
 */
export function Hero({
  onCompare,
  onTry,
  onUpload,
}: {
  onCompare: (replay: Replay) => void;
  onTry: () => void;
  onUpload: () => void;
}) {
  const featured = REPLAYS[0] ?? null;
  const file = useReplayFile(REPLAY_PATHS);
  const replay = file.kind === "ready" ? file.replay : null;
  const { ref, seen } = useOnScreen<HTMLDivElement>();
  const player = useReplayPlayer(replay, seen);
  const [hidden, setHidden] = useState(false);
  const idleClock = useMotionValue(0);
  const total = replay?.pages ?? featured?.pages ?? 500;

  useEffect(() => {
    if (!player.done) setHidden(false);
  }, [player.done]);

  return (
    <section aria-labelledby="sv-hero" className="flex flex-col gap-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SOFT}
        className="flex flex-col gap-3"
      >
        <p className="eyebrow text-federal-blue">
          Sieve · name screening for AML files
        </p>
        <h1
          id="sv-hero"
          className="max-w-4xl font-mono text-[2rem] leading-[1.05] font-bold tracking-[-0.02em] uppercase sm:text-5xl lg:text-[3.6rem]"
        >
          Every name. Every page.{" "}
          <span className="text-federal-blue">In minutes.</span>
        </h1>
      </motion.div>

      {replay ? (
        <div className="-mb-2 flex flex-wrap items-center justify-end gap-2">
          <fieldset className="flex gap-1.5">
            <legend className="sr-only">Playback speed</legend>
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={player.speed === speed}
                onClick={() => player.setSpeed(speed)}
                className={cx(
                  control,
                  player.speed === speed ? "bg-ink text-paper" : "bg-paper",
                )}
              >
                {speed}×
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={player.playing ? player.pause : player.resume}
            aria-label={player.playing ? "Pause" : "Play"}
            className={cx(control, "w-9 bg-paper")}
          >
            {player.playing ? "❚❚" : "▶"}
          </button>
          <button
            type="button"
            onClick={player.restart}
            aria-label="Replay from the start"
            className={cx(control, "w-9 bg-paper")}
          >
            ↻
          </button>
          <button
            type="button"
            onClick={player.skip}
            disabled={!player.playing}
            className={cx(control, "bg-paper disabled:opacity-40")}
          >
            Skip to end
          </button>
        </div>
      ) : null}

      <div ref={ref}>
        <RunStage
          view={replay ? player.view : emptyRunView}
          total={total}
          clock={replay ? player.clock : idleClock}
          pool={replay?.names}
          top={
            <div className="flex flex-wrap items-center justify-between gap-2 border-paper/10 border-b px-4 py-2.5 sm:px-6">
              <p className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  className={cx(
                    "size-2 shrink-0 rounded-sm",
                    player.playing
                      ? "bg-seal-red motion-safe:animate-pulse"
                      : "bg-paper/40",
                  )}
                />
                <span className="truncate">
                  {replay ? (
                    <>
                      <span className="text-paper/60">
                        Replay of a real run ·{" "}
                      </span>
                      {replay.title}
                    </>
                  ) : file.kind === "loading" ? (
                    "Loading a recorded run…"
                  ) : (
                    "A recorded run will play here"
                  )}
                </span>
              </p>
            </div>
          }
          overlay={
            <AnimatePresence>
              {replay && player.done && !hidden ? (
                <EndMoment
                  key="end"
                  replay={replay}
                  onCompare={() => onCompare(replay)}
                  onTry={onTry}
                  onUpload={onUpload}
                  onReplay={player.restart}
                  onHide={() => setHidden(true)}
                />
              ) : null}
              {file.kind === "missing" ? (
                <motion.div
                  key="missing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-ink/60 p-4"
                >
                  <div className="flex max-w-md flex-col items-center gap-3 text-center">
                    <p className="font-mono text-xl font-bold uppercase">
                      Watch it read a file live
                    </p>
                    <button
                      type="button"
                      onClick={onTry}
                      className="outline-box press inline-flex h-10 items-center rounded-sm bg-brass px-4 font-mono text-xs font-bold text-ink uppercase"
                    >
                      Pick a document ↓
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          }
        />
      </div>
    </section>
  );
}
