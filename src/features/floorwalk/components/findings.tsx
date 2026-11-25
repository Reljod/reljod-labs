"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { useEffect, useState } from "react";
import { cx } from "@/features/harness/components/ui";
import { ruleById, type Standard } from "../domain/rules";
import {
  type AnswerKey,
  dueWords,
  type Finding,
  measureWalk,
  type Scored,
} from "../domain/walk";
import { grabFrame } from "./frames";
import {
  clock,
  money,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  severityOf,
} from "./look";
import type { WalkState } from "./use-walk";

/** One Finding: the frame it was seen in, the Rule, what to do and by when. */
export function FindingCard({
  finding,
  index,
  src,
  standard,
  clockStart,
  counted,
  onSeek,
  captured,
}: {
  finding: Finding;
  index: number;
  src: string;
  standard: Standard;
  clockStart?: string;
  counted: boolean;
  onSeek: (t: number) => void;
  /** A frame taken from the main video as the playhead passed, when the hidden grab failed. */
  captured: string | null;
}) {
  const rule = ruleById(finding.rule);
  const severity = severityOf(finding, standard);
  const color = SEVERITY_COLOR[severity];
  const [frame, setFrame] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void grabFrame(src, finding.at, finding.box, color).then((url) => {
      if (live) setFrame(url);
    });
    return () => {
      live = false;
    };
  }, [src, finding.at, finding.box, color]);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -24, rotate: -2, scale: 0.9 }}
      animate={{ opacity: counted ? 1 : 0.45, y: 0, rotate: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="list-none"
      data-testid="floorwalk-finding"
    >
      <button
        type="button"
        onClick={() => onSeek(Math.max(0, finding.at - 0.6))}
        className="press outline-box grid w-full grid-cols-[7.5rem_1fr] gap-3 rounded-sm bg-paper p-2 text-left sm:grid-cols-[9.5rem_1fr]"
      >
        <span className="relative block aspect-video overflow-hidden rounded-sm border-2 border-ink bg-ink">
          {(frame ?? captured) ? (
            // biome-ignore lint/performance/noImgElement: a data URL captured in the browser
            <img
              src={frame ?? captured ?? undefined}
              alt=""
              className="fw-develop h-full w-full object-cover"
            />
          ) : (
            <span className="fw-shimmer absolute inset-0" />
          )}
          <span
            className="absolute top-1 left-1 grid h-5 w-5 place-items-center rounded-full border-2 border-ink font-mono text-[10px] font-black text-paper"
            style={{ background: color }}
          >
            {index + 1}
          </span>
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-sm border border-ink px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-paper"
              style={{ background: color }}
            >
              {SEVERITY_LABEL[severity]}
            </span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.06em]">
              {rule?.title ?? finding.rule}
            </span>
            {!counted ? (
              <span className="font-mono text-[10px] text-ink-muted uppercase">
                · Rule off
              </span>
            ) : null}
          </span>
          <span className="mt-1 block text-sm leading-snug">{finding.saw}</span>
          <span className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-ink-muted uppercase">
            <span>
              ▶ {clock(finding.at)}
              {finding.alsoAt.length ? ` +${finding.alsoAt.length} more` : ""}
            </span>
            {finding.zone ? <span>{finding.zone}</span> : null}
            {rule ? (
              <span className="font-bold text-ink">
                Fix: {dueWords(rule, clockStart, finding.at)}
              </span>
            ) : null}
            <span>{Math.round(finding.confidence * 100)}% sure</span>
          </span>
        </span>
      </button>
    </motion.li>
  );
}

/** The Score, counting to its value, with the band stamped on when the Walk is done. */
export function ScoreCard({
  scored,
  state,
  findingsCount,
}: {
  scored: Scored;
  state: WalkState;
  findingsCount: number;
}) {
  const value = useMotionValue(100);
  const shown = useTransform(value, (v) => Math.round(v));
  const [text, setText] = useState(100);
  useEffect(() => shown.on("change", setText), [shown]);
  useEffect(() => {
    const controls = animate(value, scored.score, {
      duration: 0.9,
      ease: [0.2, 0.8, 0.2, 1],
    });
    return () => controls.stop();
  }, [scored.score, value]);
  const done = state.phase === "done";
  const tone =
    scored.band.tone === "pass"
      ? "#2f6b3f"
      : scored.band.tone === "fix"
        ? "#d9a84e"
        : "#b23a2b";
  const bySeverity = (["critical", "major", "minor"] as const).map((s) => ({
    s,
    n: scored.counted.filter((c) => c.severity === s).length,
  }));
  const angle = (text / 100) * 270;

  return (
    <div
      className="relative flex items-center gap-4"
      data-testid="floorwalk-score"
    >
      <div className="relative h-28 w-28 shrink-0">
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full -rotate-[135deg]"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#e4dccb"
            strokeWidth="10"
            strokeDasharray="198 264"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={tone}
            strokeWidth="10"
            strokeDasharray={`${(angle / 360) * 264} 264`}
            style={{ transition: "stroke 0.4s" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-mono text-3xl leading-none font-black tabular-nums">
              {text}
            </div>
            <div className="eyebrow mt-1 text-[9px] text-ink-muted">Score</div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {bySeverity.map(({ s, n }) => (
          <div
            key={s}
            className="flex items-center gap-2 font-mono text-[11px] uppercase"
          >
            <span className="w-16 font-bold">{SEVERITY_LABEL[s]}</span>
            <span className="flex flex-1 gap-0.5">
              {Array.from({ length: n }, (_, i) => (
                <motion.span
                  // biome-ignore lint/suspicious/noArrayIndexKey: identical tally marks
                  key={i}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  className="h-3.5 w-2.5 origin-bottom border border-ink"
                  style={{ background: SEVERITY_COLOR[s] }}
                />
              ))}
            </span>
            <span className="tabular-nums">{n}</span>
          </div>
        ))}
        <div className="font-mono text-[10px] text-ink-muted uppercase">
          {findingsCount} found · 100 − {SEVERITY_LABEL.critical.toLowerCase()}{" "}
          25, major 10, minor 4
        </div>
      </div>
      <AnimatePresence>
        {done ? (
          <motion.div
            key={scored.band.label}
            initial={{ scale: 2.4, opacity: 0, rotate: -18 }}
            animate={{ scale: 1, opacity: 1, rotate: -8 }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 14,
              delay: 0.25,
            }}
            className="pointer-events-none absolute -top-3 right-0 rounded-sm border-[3px] px-2 py-1 font-mono text-sm font-black tracking-[0.1em] uppercase"
            style={{
              color: tone,
              borderColor: tone,
              background: "rgba(255,255,255,0.85)",
            }}
            data-testid="floorwalk-band"
          >
            {scored.band.label}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** One line on what the Walk cost: the model, the footage, the time, the money. */
export function WalkMeta({ state }: { state: WalkState }) {
  if (!state.done) return null;
  const replay = state.mode === "replay";
  return (
    <p className="font-mono text-[11px] text-ink-muted">
      {replay ? "Recorded real Walk · " : ""}
      {state.model?.replace("google/", "")} watched {Math.round(state.seconds)}{" "}
      s of footage in {(state.done.ms / 1000).toFixed(1)} s ·{" "}
      {state.done.usage.inputTokens.toLocaleString()} in /{" "}
      {state.done.usage.outputTokens.toLocaleString()} out ·{" "}
      {money(state.done.usage.costUsd)}
      {replay ? " (replayed free)" : ""}
    </p>
  );
}

/** For a Sample: how the Walk did against the answer key the render wrote. */
export function AnswerKeyCard({
  answerKey,
  findings,
  onSeek,
}: {
  answerKey: AnswerKey;
  findings: Finding[];
  onSeek: (t: number) => void;
}) {
  const m = measureWalk(findings, answerKey);
  const planted = m.found.length + m.missed.length;
  const decoys = m.fooled.length + m.resisted.length;
  const rows = [
    ...m.found.map((f) => ({
      id: f.item.id,
      ok: true,
      label: f.item.note,
      tag: "Found",
      at: f.finding.at,
    })),
    ...m.missed.map((item) => ({
      id: item.id,
      ok: false,
      label: item.note,
      tag: "Missed",
      at: item.best?.at ?? 0,
    })),
    ...m.resisted.map((item) => ({
      id: item.id,
      ok: true,
      label: item.note,
      tag: "Decoy left alone",
      at: item.best?.at ?? 0,
    })),
    ...m.fooled.map((f) => ({
      id: f.item.id,
      ok: false,
      label: f.item.note,
      tag: "Fooled by decoy",
      at: f.finding.at,
    })),
  ];
  return (
    <div data-testid="floorwalk-answer-key">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-2xl font-black tabular-nums">
          {m.found.length}/{planted}
        </span>
        <span className="eyebrow text-[10px] text-ink-muted">
          planted problems found
        </span>
        <span className="font-mono text-2xl font-black tabular-nums">
          {m.resisted.length}/{decoys}
        </span>
        <span className="eyebrow text-[10px] text-ink-muted">
          decoys left alone
        </span>
        {m.extra.length ? (
          <span className="font-mono text-[11px] text-ink-muted">
            +{m.extra.length} not in the key
          </span>
        ) : null}
      </div>
      <ul className="mt-2 space-y-1">
        {rows.map((row, i) => (
          <motion.li
            key={row.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 * i }}
          >
            <button
              type="button"
              onClick={() => onSeek(Math.max(0, row.at - 0.6))}
              className="flex w-full items-center gap-2 text-left text-[13px] hover:underline"
            >
              <span
                className={cx(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-sm border-2 border-ink font-bold text-[11px]",
                  row.ok ? "bg-ivy text-paper" : "bg-seal-red text-paper",
                )}
              >
                {row.ok ? "✓" : "✕"}
              </span>
              <span className="w-28 shrink-0 font-mono text-[10px] uppercase">
                {row.tag}
              </span>
              <span className="min-w-0 truncate">{row.label}</span>
            </button>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
