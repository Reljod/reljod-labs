"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cx } from "@/features/harness/components/ui";
import type { Headline, Post, Voice } from "../domain/api";
import { type DrillState, heat, type Outcome } from "../domain/engine";
import type { Finding } from "../domain/rules";
import { deadlines } from "../domain/rules";
import type { Effects, GaugeId, Scenario } from "../domain/scenario";
import { GAUGES } from "../domain/scenario";
import { Counter } from "./counter";
import type { Transcript } from "./use-drill";

export const GAUGE_WORDS: Record<GaugeId, string> = {
  customers: "Customers",
  regulator: "Regulator",
  staff: "Staff",
  press: "Press",
  operations: "Operations",
  board: "Board",
};

const polar = (hour: number, hours: number, r: number) => {
  const angle = (hour / hours) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
};

/**
 * The crisis clock: 72 hours around the dial, a notch for each Round, a red
 * notch for each deadline (green once met, struck once missed) and a hand
 * that sweeps to the hour of the last Round.
 */
export function CrisisClock({
  scenario,
  state,
  findings,
}: {
  scenario: Scenario;
  state: DrillState;
  findings: Finding[];
}) {
  const marks = deadlines(scenario);
  const angle = (state.hour / scenario.hours) * 360;
  const sweep = polar(state.hour, scenario.hours, 44);
  const large = state.hour / scenario.hours > 0.5 ? 1 : 0;
  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox="-60 -60 120 120"
        className="h-28 w-28 shrink-0"
        aria-hidden="true"
      >
        <circle r="54" fill="#ffffff" stroke="#14213d" strokeWidth="2.5" />
        {state.hour > 0 ? (
          <motion.path
            d={`M0 0 L0 -44 A44 44 0 ${large} 1 ${sweep.x.toFixed(2)} ${sweep.y.toFixed(2)} Z`}
            fill="#b23a2b"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.14 }}
            transition={{ duration: 0.8 }}
          />
        ) : null}
        {Array.from({ length: 24 }, (_, i) => {
          const a = polar(i * 3, 72, 50);
          const b = polar(i * 3, 72, i % 4 === 0 ? 43 : 47);
          return (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: the dial's fixed hour ticks.
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#14213d"
              strokeWidth={i % 4 === 0 ? 1.6 : 0.8}
            />
          );
        })}
        {scenario.slots.map((hour) => {
          const p = polar(hour, scenario.hours, 38);
          const played = hour <= state.hour && state.outcomes.length > 0;
          return (
            <circle
              key={hour}
              cx={p.x}
              cy={p.y}
              r="2.6"
              fill={played ? "#14213d" : "#ffffff"}
              stroke="#14213d"
              strokeWidth="1.2"
            />
          );
        })}
        {marks.map((mark) => {
          const finding = findings.find((f) => f.rule === mark.id);
          const p = polar(
            Math.min(mark.hour, scenario.hours - 0.01),
            scenario.hours,
            54,
          );
          const color =
            finding?.status === "met"
              ? "#2f6b3f"
              : finding?.status === "missed"
                ? "#b23a2b"
                : "#d9a84e";
          return (
            <g key={mark.id} transform={`translate(${p.x} ${p.y})`}>
              <circle r="5" fill={color} stroke="#14213d" strokeWidth="1.5" />
              {finding?.status === "missed" ? (
                <path
                  d="M-2.5 -2.5 L2.5 2.5 M2.5 -2.5 L-2.5 2.5"
                  stroke="#fff"
                  strokeWidth="1.4"
                />
              ) : finding?.status === "met" ? (
                <path
                  d="M-2.5 0 L-0.8 2 L2.6 -2.2"
                  stroke="#fff"
                  strokeWidth="1.4"
                  fill="none"
                />
              ) : null}
            </g>
          );
        })}
        <motion.line
          x1="0"
          y1="6"
          x2="0"
          y2="-46"
          stroke="#14213d"
          strokeWidth="3"
          strokeLinecap="round"
          initial={false}
          animate={{ rotate: angle }}
          transition={{ type: "spring", stiffness: 60, damping: 14 }}
          style={{ originX: "0px", originY: "0px" }}
        />
        <circle r="4" fill="#b23a2b" stroke="#14213d" strokeWidth="1.5" />
      </svg>
      <div className="min-w-0">
        <p className="eyebrow text-ink-muted">Crisis clock</p>
        <p
          className="font-mono text-3xl font-bold leading-none tabular-nums"
          data-testid="fb-clock"
        >
          T+
          <Counter svg={false} value={state.hour} />h
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          of {scenario.hours}h · began {scenario.startsAt}
        </p>
      </div>
    </div>
  );
}

/** Heat, the share index and the cost so far, each counting to its new value. */
export function Vitals({
  scenario,
  state,
}: {
  scenario: Scenario;
  state: DrillState;
}) {
  const h = heat(state.gauges);
  const shares = [100, ...state.outcomes.map((o) => o.share)];
  const min = Math.min(...shares, 90);
  const max = Math.max(...shares, 102);
  const points = shares
    .map((value, index) => {
      const x = (index / scenario.slots.length) * 100;
      const y = 28 - ((value - min) / (max - min || 1)) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const down = state.share < 100;
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-sm border-2 border-ink bg-paper p-2">
        <p className="eyebrow text-[10px] text-ink-muted">Heat</p>
        <p
          className={cx(
            "font-mono text-xl font-bold tabular-nums",
            h > 45 ? "text-seal-red" : h > 32 ? "text-oak" : "text-ivy",
          )}
          data-testid="fb-heat"
        >
          <Counter svg={false} value={Math.round(h)} />
        </p>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-limestone">
          <motion.div
            className="h-full bg-seal-red"
            initial={false}
            animate={{ width: `${Math.min(100, h)}%` }}
            transition={{ duration: 0.9 }}
          />
        </div>
      </div>
      <div className="rounded-sm border-2 border-ink bg-paper p-2">
        <p className="eyebrow text-[10px] text-ink-muted">Share index</p>
        <p
          className={cx(
            "font-mono text-xl font-bold tabular-nums",
            down ? "text-seal-red" : "text-ivy",
          )}
        >
          <Counter svg={false} value={state.share} decimals={1} />
        </p>
        <svg
          viewBox="0 0 100 30"
          className="h-4 w-full"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={points}
            fill="none"
            stroke={down ? "#b23a2b" : "#2f6b3f"}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="rounded-sm border-2 border-ink bg-paper p-2">
        <p className="eyebrow text-[10px] text-ink-muted">Cost so far</p>
        <p className="font-mono text-xl font-bold tabular-nums text-ink">
          <Counter
            svg={false}
            value={state.cost}
            decimals={1}
            prefix="Ƒ"
            suffix="m"
          />
        </p>
        <p className="text-[10px] text-ink-muted">florin, play money</p>
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<Finding["status"], string> = {
  met: "bg-ivy text-paper",
  open: "bg-paper text-ink",
  missed: "bg-seal-red text-paper",
  broken: "bg-ink text-paper",
};

const STATUS_WORD: Record<Finding["status"], string> = {
  met: "Met",
  open: "Open",
  missed: "Missed",
  broken: "Broken",
};

/** The Rulebook as a strip of seals: each Rule's status, from code. */
export function RulesStrip({ findings }: { findings: Finding[] }) {
  return (
    <ul className="flex flex-col gap-1.5" data-testid="fb-rules">
      {findings.map((finding) => (
        <li
          key={finding.rule}
          className="flex items-start gap-2 text-xs leading-snug"
        >
          <motion.span
            key={finding.status}
            initial={{ scale: 1.8, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: -4, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 18 }}
            className={cx(
              "mt-0.5 inline-block w-14 shrink-0 rounded-sm border-2 border-ink px-1 text-center font-mono text-[10px] font-bold uppercase",
              STATUS_STYLE[finding.status],
            )}
          >
            {STATUS_WORD[finding.status]}
          </motion.span>
          <span>
            {finding.text}{" "}
            <span className="text-ink-muted">{finding.note}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Types a line out, a few characters at a time. */
function Typed({ text, speed = 18 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const timer = window.setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          window.clearInterval(timer);
          return n;
        }
        return n + 2;
      });
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, speed]);
  const done = shown >= text.length;
  return (
    <span className={done ? "" : "fb-caret"}>
      {text.slice(0, shown)}
      <span className="sr-only">{text.slice(shown)}</span>
    </span>
  );
}

const MOOD: Record<number, string> = {
  [-2]: "#b23a2b",
  [-1]: "#d9a84e",
  0: "#8a8478",
  1: "#6fa0dc",
  2: "#2f6b3f",
};

/** The Room: what the Stakeholders said this Round, typed in as it arrives. */
export function RoomVoices({
  scenario,
  transcript,
  thinking,
}: {
  scenario: Scenario;
  transcript: Transcript | null;
  thinking: boolean;
}) {
  const voices = transcript?.voices ?? [];
  return (
    <div
      className="flex flex-col gap-2"
      aria-live="polite"
      data-testid="fb-voices"
    >
      <AnimatePresence initial={false}>
        {voices.map((voice: Voice, index) => {
          const person = scenario.stakeholders.find(
            (s) => s.gauge === voice.who,
          );
          return (
            <motion.div
              key={`${index}-${voice.who}`}
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="flex gap-2.5"
            >
              <span
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink font-mono text-[11px] font-bold"
                style={{
                  background: MOOD[voice.mood] ?? "#ffffff",
                  color: "#ffffff",
                }}
                aria-hidden="true"
              >
                {person?.initials}
              </span>
              <div className="min-w-0 flex-1 rounded-sm border-2 border-ink bg-paper px-3 py-2 shadow-hard-sm">
                <p className="eyebrow text-[10px] text-ink-muted">
                  {person?.name} · {person?.role}
                </p>
                <p className="mt-0.5 text-sm leading-snug text-ink">
                  <Typed text={voice.line} />
                </p>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {thinking && voices.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map((dot) => (
              <motion.span
                key={dot}
                className="h-1.5 w-1.5 rounded-full bg-seal-red"
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1, repeat: Infinity, delay: dot * 0.2 }}
              />
            ))}
          </span>
          The Room is reacting…
        </div>
      ) : null}
    </div>
  );
}

const SOURCE_STYLE = {
  inject: "border-ink bg-limestone",
  lever: "border-ink bg-paper",
  burn: "border-seal-red bg-seal-red/10",
} as const;

function EffectChips({ effects }: { effects: Effects }) {
  const chips = [
    ...GAUGES.flatMap((gauge) => {
      const value = effects[gauge];
      return value
        ? [
            {
              key: gauge,
              label: `${GAUGE_WORDS[gauge]} ${value > 0 ? "+" : ""}${value}`,
              good: value > 0,
            },
          ]
        : [];
    }),
    ...(effects.cost
      ? [{ key: "cost", label: `Ƒ${effects.cost}m`, good: false }]
      : []),
  ];
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={cx(
            "rounded-sm px-1 font-mono text-[10px] font-bold",
            chip.good
              ? "bg-clear-sky/40 text-federal-blue"
              : "bg-seal-red/15 text-seal-red",
          )}
        >
          {chip.label}
        </span>
      ))}
    </span>
  );
}

/** What code did with the Round, step by step: the Inject, each Lever, what kept burning. */
export function Ledger({ outcome }: { outcome: Outcome }) {
  return (
    <ol className="flex flex-col gap-1.5" data-testid="fb-ledger">
      {outcome.steps.map((step, index) => (
        <motion.li
          key={`${step.source}-${step.id}`}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.18 }}
          className={cx(
            "rounded-sm border-2 px-2 py-1.5 text-xs",
            SOURCE_STYLE[step.source],
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">
              {step.source === "burn"
                ? "Still burning: "
                : step.source === "inject"
                  ? "Landed: "
                  : "You: "}
              {step.label}
            </span>
            {step.late ? (
              <span className="shrink-0 font-mono text-[10px] font-bold text-oak uppercase">
                late, worth less
              </span>
            ) : step.repeat ? (
              <span className="shrink-0 font-mono text-[10px] font-bold text-ink-muted uppercase">
                already done
              </span>
            ) : null}
          </div>
          <div className="mt-1">
            <EffectChips effects={step.effects} />
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

/** Headlines and posts, scrolling under the stage like a news channel. */
export function Ticker({
  items,
}: {
  items: { kind: "headline" | "post"; item: Headline | Post }[];
}) {
  if (items.length === 0)
    return (
      <div className="border-ink border-t-2 bg-ink px-4 py-2 font-mono text-xs text-limestone">
        <span className="mr-3 rounded-sm bg-seal-red px-1.5 py-0.5 font-bold text-paper">
          LIVE
        </span>
        Quiet, for now.
      </div>
    );
  const row = items.map((entry) => (
    <span
      key={`${entry.kind}:${"outlet" in entry.item ? entry.item.outlet : entry.item.handle}:${entry.item.text}`}
      className="flex shrink-0 items-center gap-2 px-5"
    >
      {entry.kind === "headline" ? (
        <>
          <span className="font-bold text-brass uppercase">
            {(entry.item as Headline).outlet}
          </span>
          <span className="text-paper">{(entry.item as Headline).text}</span>
        </>
      ) : (
        <>
          <span className="text-clear-sky">@{(entry.item as Post).handle}</span>
          <span className="text-limestone">{(entry.item as Post).text}</span>
        </>
      )}
      <span className="text-seal-red" aria-hidden="true">
        ◆
      </span>
    </span>
  ));
  return (
    <div
      className="flex items-center overflow-hidden border-ink border-t-2 bg-ink py-2 font-mono text-xs"
      data-testid="fb-ticker"
    >
      <span className="z-10 ml-3 shrink-0 rounded-sm bg-seal-red px-1.5 py-0.5 font-bold text-paper">
        LIVE
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="fb-marquee">
          {row}
          <span aria-hidden="true" className="flex">
            {row}
          </span>
        </div>
      </div>
    </div>
  );
}
