"use client";

import { motion } from "motion/react";
import { cx } from "@/features/harness/components/ui";
import type { Usage } from "../domain/api";
import type { Scenario } from "../domain/scenario";
import { GAUGES } from "../domain/scenario";
import { SCENARIOS } from "../domain/scenarios";
import { GAUGE_WORDS } from "./panels";

const STAGES = [
  { who: "you", title: "You decide", detail: "A card, or your own words." },
  {
    who: "model",
    title: "Reader",
    detail: "Qwen4-Max maps your words to Levers. Only real Levers survive.",
  },
  {
    who: "code",
    title: "Engine",
    detail: "Pressure, Levers, lateness, what keeps burning. Every number.",
  },
  {
    who: "code",
    title: "Rules",
    detail: "Deadlines, order, never-dos. Met, missed or broken.",
  },
  {
    who: "model",
    title: "Room",
    detail:
      "Six voices react to what code computed, and pick the next Inject from code's list.",
  },
  {
    who: "model",
    title: "Comms lead",
    detail: "Drafts the Statement at T+72h.",
  },
  {
    who: "code",
    title: "Checks",
    detail:
      "Who, what to do, next update, no guessing, no blame, no false promises. Fail: back to the Comms lead.",
  },
] as const;

const TONE = {
  you: "bg-brass text-ink",
  model: "bg-federal-blue text-paper",
  code: "bg-ink text-paper",
} as const;

/** The pipeline, the contract between the model and code, and what this session spent. */
export function UnderTheHood({
  scenario,
  usage,
  model,
}: {
  scenario: Scenario | null;
  usage: Usage[];
  model: string;
}) {
  const shown = scenario ?? SCENARIOS[0];
  const total = usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
  return (
    <div className="flex flex-col gap-6" data-testid="fb-hood">
      <section className="rounded-sm border-2 border-ink bg-paper p-4 shadow-hard-md">
        <p className="eyebrow text-ink-muted">One Round, end to end</p>
        <h2 className="mt-1 text-2xl font-bold">
          The model voices. Code decides.
        </h2>
        <ol className="mt-4 flex flex-col gap-0 lg:flex-row lg:items-stretch">
          {STAGES.map((stage, index) => (
            <li
              key={stage.title}
              className="flex flex-1 flex-col items-stretch lg:flex-row lg:items-center"
            >
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.12 }}
                className="flex-1 rounded-sm border-2 border-ink bg-marble p-2.5"
              >
                <span
                  className={cx(
                    "rounded-sm px-1.5 font-mono text-[10px] font-bold uppercase",
                    TONE[stage.who],
                  )}
                >
                  {stage.who === "you"
                    ? "you"
                    : stage.who === "model"
                      ? model
                      : "code"}
                </span>
                <p className="mt-1 text-sm font-bold">{stage.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-ink-muted">
                  {stage.detail}
                </p>
              </motion.div>
              {index < STAGES.length - 1 ? (
                <span
                  className="flex items-center justify-center py-1 font-mono text-seal-red lg:px-1 lg:py-0"
                  aria-hidden="true"
                >
                  <span className="lg:hidden">↓</span>
                  <span className="hidden lg:inline">→</span>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <p>
            <span className="font-bold">Stateless by design.</span> The drill
            lives in your browser. Every request sends its Rounds back and the
            server replays them through the Engine, refusing any it could not
            have produced.
          </p>
          <p>
            <span className="font-bold">The model never moves a number.</span>{" "}
            The Reader may only name Levers that exist; the Room may only pick
            the next Inject from the ones the Engine allows. Anything else is
            dropped.
          </p>
          <p>
            <span className="font-bold">Draft, check, revise.</span> Qwen4-Max
            was released on 16 November 2026 as an agent that delivers a first
            version and revises it from feedback. Here, the feedback is code.
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-sm border-2 border-ink bg-paper p-4">
          <p className="eyebrow text-ink-muted">
            {shown?.company}: the Rulebook
          </p>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {shown?.rules.map((rule) => (
              <li key={rule.id} className="border-ink/20 border-b pb-2">
                <span className="mr-1 rounded-sm bg-ink px-1 font-mono text-[10px] text-paper uppercase">
                  {rule.kind}
                </span>
                {rule.text}{" "}
                <span className="text-xs text-ink-muted">({rule.source})</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-sm border-2 border-ink bg-paper p-4">
          <p className="eyebrow text-ink-muted">
            {shown?.company}: the Levers and what they do
          </p>
          <div className="mt-2 max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-paper">
                <tr className="border-ink border-b-2">
                  <th className="py-1 pr-2">Lever</th>
                  {GAUGES.map((g) => (
                    <th
                      key={g}
                      className="px-1 text-right font-mono"
                      title={GAUGE_WORDS[g]}
                    >
                      {GAUGE_WORDS[g].slice(0, 4)}
                    </th>
                  ))}
                  <th className="px-1 text-right font-mono">Ƒm</th>
                </tr>
              </thead>
              <tbody>
                {shown?.levers.map((lever) => (
                  <tr key={lever.id} className="border-ink/10 border-b">
                    <td className="py-1 pr-2">
                      {lever.label}
                      {lever.late ? (
                        <span className="ml-1 text-[10px] text-oak">
                          (worth {Math.round(lever.late.factor * 100)}% after T+
                          {lever.late.after}h)
                        </span>
                      ) : null}
                    </td>
                    {GAUGES.map((g) => {
                      const v = lever.effects[g];
                      return (
                        <td
                          key={g}
                          className={cx(
                            "px-1 text-right font-mono",
                            v
                              ? v > 0
                                ? "text-federal-blue"
                                : "text-seal-red"
                              : "text-ink-muted/40",
                          )}
                        >
                          {v ? (v > 0 ? `+${v}` : v) : "·"}
                        </td>
                      );
                    })}
                    <td className="px-1 text-right font-mono">
                      {lever.effects.cost ?? "·"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-sm border-2 border-ink bg-paper p-4">
        <p className="eyebrow text-ink-muted">This session's model calls</p>
        {usage.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            None yet. The recorded drill makes none.
          </p>
        ) : (
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="border-ink border-b-2">
                <th className="py-1">Call</th>
                <th>Model</th>
                <th className="text-right">Tokens in / out</th>
                <th className="text-right">Time</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {usage.map((u, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log.
                <tr key={index} className="border-ink/10 border-b">
                  <td className="py-1">{u.call}</td>
                  <td>{u.model}</td>
                  <td className="text-right">
                    {u.inputTokens ?? "?"} / {u.outputTokens ?? "?"}
                  </td>
                  <td className="text-right">{(u.ms / 1000).toFixed(1)}s</td>
                  <td className="text-right">
                    {u.costUsd === null ? "?" : `$${u.costUsd.toFixed(4)}`}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-1 font-bold" colSpan={4}>
                  Total
                </td>
                <td className="text-right font-bold">${total.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
