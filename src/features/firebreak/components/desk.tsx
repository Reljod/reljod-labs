"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button, cx, inputClass } from "@/features/harness/components/ui";
import type { Reading } from "../domain/brief";
import type { Choice } from "../domain/engine";
import { leverById } from "../domain/engine";
import { LIMITS } from "../domain/limits";
import type { Inject, Scenario } from "../domain/scenario";

/** The Inject on the desk: it slams down with its hour stamped on it. */
export function InjectCard({
  scenario,
  inject,
  hour,
}: {
  scenario: Scenario;
  inject: Inject;
  hour: number;
}) {
  const from = scenario.stakeholders.find((s) => s.gauge === inject.from);
  return (
    <motion.article
      key={inject.id}
      initial={{ opacity: 0, y: -40, rotate: -3, scale: 1.06 }}
      animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
      exit={{ opacity: 0, x: 120, rotate: 6 }}
      transition={{ type: "spring", stiffness: 210, damping: 20 }}
      className="relative rounded-sm border-2 border-ink bg-paper p-4 shadow-hard-md"
      data-testid="fb-inject"
    >
      <span className="fb-stamp absolute -top-3 right-3 rounded-sm border-2 border-seal-red bg-paper px-2 py-0.5 font-mono text-xs font-bold text-seal-red">
        T+{hour}h
      </span>
      <p className="eyebrow text-ink-muted">
        From {from?.name} · {from?.role}
      </p>
      <h3 className="mt-1 text-2xl font-bold leading-tight text-ink">
        {inject.title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink">{inject.body}</p>
    </motion.article>
  );
}

/**
 * The three Options, dealt like cards, and a line to write your own decision.
 * In the recorded drill, `autoPick` names the Option about to be played so it
 * lights up before it is taken.
 */
export function Choices({
  scenario,
  inject,
  taken,
  disabled,
  autoPick,
  onDecide,
}: {
  scenario: Scenario;
  inject: Inject;
  taken: Record<string, number>;
  disabled: boolean;
  autoPick: string | null;
  onDecide: (choice: Choice) => void;
}) {
  const [own, setOwn] = useState("");
  // The parent keys this by the Inject, so a new card starts with an empty line.
  const [writing, setWriting] = useState(false);
  const trimmed = own.trim();
  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow text-ink-muted">Your call</p>
      {inject.options.map((option, index) => {
        const done = option.levers.every((id) => id in taken);
        const picked = autoPick === option.id;
        return (
          <motion.button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onDecide({ kind: "option", option: option.id })}
            initial={{ opacity: 0, y: 30, rotate: index % 2 ? 2 : -2 }}
            animate={{
              opacity: 1,
              y: 0,
              rotate: 0,
              scale: picked ? 1.03 : 1,
            }}
            transition={{
              delay: 0.25 + index * 0.12,
              type: "spring",
              stiffness: 240,
              damping: 20,
            }}
            className={cx(
              "press group w-full rounded-sm border-2 border-ink px-3 py-2.5 text-left disabled:cursor-not-allowed",
              picked ? "bg-brass" : "bg-paper hover:bg-morning-haze",
              disabled && !picked ? "opacity-60" : "",
            )}
            data-testid={`fb-option-${index}`}
          >
            <span className="flex items-start gap-2">
              <span className="mt-0.5 font-mono text-xs font-bold text-ink-muted">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">
                  {option.label}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {option.levers.map((id) => (
                    <span
                      key={id}
                      className={cx(
                        "rounded-sm border border-ink/40 px-1 font-mono text-[10px]",
                        id in taken
                          ? "text-ink-muted line-through"
                          : "text-ink",
                      )}
                    >
                      {leverById(scenario, id)?.label}
                    </span>
                  ))}
                </span>
                {done ? (
                  <span className="mt-1 block text-[11px] text-oak">
                    Already done: it will change nothing.
                  </span>
                ) : null}
              </span>
            </span>
          </motion.button>
        );
      })}
      {writing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length >= 3) onDecide({ kind: "own", text: trimmed });
          }}
        >
          <label className="eyebrow text-ink-muted" htmlFor="fb-own">
            In your own words
          </label>
          <textarea
            id="fb-own"
            className={cx(inputClass, "min-h-24 resize-y text-sm")}
            maxLength={LIMITS.ownWords}
            placeholder="e.g. Go public now, refund everyone, and get the union on the phone before the evening flights."
            value={own}
            disabled={disabled}
            onChange={(event) => setOwn(event.target.value)}
            data-testid="fb-own"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-ink-muted">
              {own.length}/{LIMITS.ownWords} · Qwen4-Max reads it into Levers
            </span>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={disabled || trimmed.length < 3}
            >
              Decide
            </Button>
          </div>
        </form>
      ) : (
        <motion.button
          type="button"
          disabled={disabled}
          onClick={() => setWriting(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="press rounded-sm border-2 border-dashed border-ink bg-marble px-3 py-2 text-left text-sm font-semibold disabled:opacity-60"
          data-testid="fb-write-own"
        >
          ✎ Something else: write your own decision
        </motion.button>
      )}
    </div>
  );
}

/** What the Reader heard in the executive's words, and which Levers it pulled. */
export function ReadingCard({
  scenario,
  reading,
}: {
  scenario: Scenario;
  reading: Reading;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-sm border-2 border-ink bg-morning-haze p-3"
      data-testid="fb-reading"
    >
      <p className="eyebrow text-federal-blue">The Reader heard</p>
      <p className="mt-1 text-sm italic text-ink">“{reading.heard}”</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <AnimatePresence>
          {reading.levers.length ? (
            reading.levers.map((id, index) => (
              <motion.span
                key={id}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  delay: 0.2 + index * 0.15,
                  type: "spring",
                  stiffness: 400,
                  damping: 16,
                }}
                className="rounded-sm border-2 border-ink bg-paper px-1.5 py-0.5 font-mono text-[11px] font-bold"
              >
                ⚙ {leverById(scenario, id)?.label}
              </motion.span>
            ))
          ) : (
            <span className="text-xs text-ink-muted">
              No Lever matched: the clock runs on.
            </span>
          )}
        </AnimatePresence>
      </div>
      {reading.outside ? (
        <p className="mt-2 text-xs text-ink-muted">
          Outside the drill: {reading.outside}
        </p>
      ) : null}
    </motion.div>
  );
}

/** The chief of staff's line, leaning in before the next card lands. */
export function Whisper({ text }: { text: string }) {
  return (
    <motion.p
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="border-brass border-l-4 bg-paper px-3 py-2 text-sm italic text-ink"
      data-testid="fb-whisper"
    >
      <span className="eyebrow mr-1 not-italic text-oak">Chief of staff:</span>
      {text}
    </motion.p>
  );
}
