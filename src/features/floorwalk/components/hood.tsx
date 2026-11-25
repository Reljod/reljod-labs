"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { cx, Panel } from "@/features/harness/components/ui";
import { walkInstructions, walkPrompt } from "../domain/brief";
import { rulesFor } from "../domain/rules";
import type { Site } from "../domain/sites";
import { REFUSAL_WORDS } from "../domain/walk";
import { money } from "./look";
import type { RawLine, WalkState } from "./use-walk";

const OUTCOME: Record<RawLine["outcome"], { label: string; tone: string }> = {
  zone: { label: "zone", tone: "bg-morning-haze text-federal-blue" },
  finding: { label: "finding", tone: "bg-ivy text-paper" },
  merged: { label: "merged", tone: "bg-limestone text-ink" },
  noticed: { label: "noticed", tone: "bg-marble text-ink-muted" },
  refused: { label: "refused", tone: "bg-seal-red text-paper" },
  skipped: { label: "not a line", tone: "bg-stone text-paper" },
};

const STEPS = [
  {
    title: "Footage",
    body: "One MP4, sent whole. No frames picked, no captions.",
  },
  {
    title: "Gemini 4 Neon",
    body: "Watches the video natively and writes NDJSON lines as it goes.",
  },
  {
    title: "Checks",
    body: "Code parses each line and decides: Finding, merged, noticed or refused.",
  },
  {
    title: "Standard",
    body: "Rules are data. Severity and weight come from here, never the model.",
  },
  {
    title: "Score and Fix list",
    body: "Pure functions. Change the Standard and it re-scores, no call.",
  },
];

/** How a Walk works, with this Walk's own lines as they arrived. */
export function HoodTab({
  state,
  site,
}: {
  state: WalkState;
  site: Site | null;
}) {
  const log = useRef<HTMLOListElement>(null);
  const lines = state.raw.length;
  // Keep the newest line in view as lines arrive.
  useEffect(() => {
    const el = log.current;
    if (el && lines) el.scrollTop = el.scrollHeight;
  }, [lines]);
  const active = state.phase === "walking" || state.phase === "loading";

  return (
    <div className="space-y-4">
      <Panel title="One call, then code" eyebrow="The loop" bodyClassName="p-4">
        <ol className="grid gap-3 md:grid-cols-5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative">
              <div
                className={cx(
                  "outline-box rounded-sm bg-paper p-3",
                  active && "fw-step-live",
                )}
                style={{ animationDelay: `${i * 0.35}s` }}
              >
                <p className="eyebrow text-[10px] text-ink-muted">
                  Step {i + 1}
                </p>
                <p className="font-mono text-sm font-bold uppercase">
                  {step.title}
                </p>
                <p className="mt-1 text-[13px] leading-snug">{step.body}</p>
              </div>
              {i < STEPS.length - 1 ? (
                <span className="fw-flow absolute top-1/2 -right-3 hidden h-0.5 w-3 bg-ink md:block" />
              ) : null}
            </li>
          ))}
        </ol>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="What the Walker wrote"
          eyebrow={
            state.raw.length
              ? `${state.raw.length} lines`
              : "Walk a Sample to fill this"
          }
          bodyClassName="p-0"
        >
          <ol
            ref={log}
            className="h-[26rem] overflow-auto bg-ink p-3 font-mono text-[11px] leading-relaxed text-paper"
            data-testid="floorwalk-raw"
          >
            <AnimatePresence initial={false}>
              {state.raw.map((line, i) => (
                <motion.li
                  // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex gap-2 border-paper/10 border-b py-1"
                >
                  <span
                    className={cx(
                      "h-fit shrink-0 rounded-sm px-1 text-[9px] font-bold uppercase",
                      OUTCOME[line.outcome].tone,
                    )}
                  >
                    {OUTCOME[line.outcome].label}
                  </span>
                  <span className="break-all opacity-90">{line.line}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
          {state.refused.length ? (
            <ul className="space-y-1 border-ink border-t-2 p-3 text-[13px]">
              {state.refused.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: refusals have no id
                <li key={i}>
                  <span className="font-mono text-[10px] font-bold text-seal-red uppercase">
                    Refused
                  </span>{" "}
                  “{r.sighting.saw}”: {REFUSAL_WORDS[r.reason]}.
                </li>
              ))}
            </ul>
          ) : null}
          {state.done ? (
            <p className="border-ink border-t-2 px-3 py-2 font-mono text-[11px]">
              {state.done.usage.inputTokens.toLocaleString()} tokens in ·{" "}
              {state.done.usage.outputTokens.toLocaleString()} out ·{" "}
              {money(state.done.usage.costUsd)} ·{" "}
              {(state.done.ms / 1000).toFixed(1)} s
            </p>
          ) : null}
        </Panel>
        <Panel
          title="What the Walker reads"
          eyebrow="Written by code, never by the visitor"
          bodyClassName="p-0"
        >
          <pre className="h-[26rem] overflow-auto bg-marble p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
            {walkInstructions()}
            {"\n\n────────\n\n"}
            {walkPrompt(
              rulesFor(site?.kind ?? null),
              site,
              state.seconds || null,
            )}
          </pre>
        </Panel>
      </div>
    </div>
  );
}
