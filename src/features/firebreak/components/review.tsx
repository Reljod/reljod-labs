"use client";

import { motion } from "motion/react";
import { Button, cx } from "@/features/harness/components/ui";
import { diffWords } from "../domain/diff";
import type { DrillState } from "../domain/engine";
import { CONTAINED_HEAT, type Scorecard } from "../domain/review";
import { GAUGES, type Scenario } from "../domain/scenario";
import { STATEMENT_WORDS } from "../domain/statement";
import { GAUGE_WORDS, RulesStrip } from "./panels";
import type { Debrief, Draft } from "./use-drill";

const GRADE_COLOR: Record<Scorecard["grade"], string> = {
  A: "text-ivy border-ivy",
  B: "text-federal-blue border-federal-blue",
  C: "text-oak border-oak",
  D: "text-seal-red border-seal-red",
  E: "text-seal-red border-seal-red",
};

const GRADE_WORDS: Record<Scorecard["grade"], string> = {
  A: "Contained. The board will want you to teach this.",
  B: "Held. Some scars, no fire.",
  C: "Survived. The post-mortem will be long.",
  D: "Burned. The story outlived the incident.",
  E: "Lost. Someone else will write this chapter.",
};

/** Heat over the 72 hours, with the line under which it counts as contained. */
function HeatChart({ card, hours }: { card: Scorecard; hours: number }) {
  const w = 320;
  const h = 120;
  const x = (hour: number) => (hour / hours) * w;
  const y = (heat: number) => h - (heat / 70) * h;
  const line = card.heatline
    .map((p) => `${x(p.hour).toFixed(1)},${y(p.heat).toFixed(1)}`)
    .join(" ");
  const area = `0,${h} ${line} ${x(card.heatline[card.heatline.length - 1]?.hour ?? 0).toFixed(1)},${h}`;
  return (
    <svg
      viewBox={`-18 -6 ${w + 36} ${h + 26}`}
      className="h-auto max-h-56 w-full"
      role="img"
      aria-label="Heat over the drill"
    >
      <line
        x1="0"
        x2={w}
        y1={y(CONTAINED_HEAT)}
        y2={y(CONTAINED_HEAT)}
        stroke="#2f6b3f"
        strokeDasharray="4 3"
      />
      <text
        x={w}
        y={y(CONTAINED_HEAT) - 3}
        textAnchor="end"
        fontSize="8"
        fill="#2f6b3f"
        className="font-mono"
      >
        contained
      </text>
      <motion.polygon
        points={area}
        fill="#b23a2b"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.18 }}
        transition={{ duration: 1 }}
      />
      <motion.polyline
        points={line}
        fill="none"
        stroke="#b23a2b"
        strokeWidth="2.5"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.6, ease: "easeInOut" }}
      />
      {card.heatline.map((p, i) => (
        <motion.circle
          key={`h${p.hour}`}
          cx={x(p.hour)}
          cy={y(p.heat)}
          r={p === card.peak ? 4.5 : 2.6}
          fill={p === card.peak ? "#b23a2b" : "#ffffff"}
          stroke="#14213d"
          strokeWidth="1.5"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2 + i * 0.2 }}
        />
      ))}
      <line x1="0" x2={w} y1={h} y2={h} stroke="#14213d" strokeWidth="1.5" />
      {[0, 24, 48, 72].map((hour) => (
        <text
          key={hour}
          x={x(hour)}
          y={h + 12}
          fontSize="8"
          textAnchor="middle"
          fill="#4a4f5b"
          className="font-mono"
        >
          T+{hour}h
        </text>
      ))}
    </svg>
  );
}

function DraftView({
  draft,
  previous,
}: {
  draft: Draft;
  previous: Draft | null;
}) {
  const pieces = previous
    ? diffWords(previous.text, draft.text)
    : [{ kind: "same" as const, text: draft.text }];
  const struck = new Set(
    (draft.notes ?? []).flatMap((note) =>
      note.quotes.map((q) => q.toLowerCase()),
    ),
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={cx(
        "rounded-sm border-2 bg-paper p-3",
        draft.notes && draft.passed
          ? "border-ivy shadow-[4px_4px_0_var(--color-ivy)]"
          : "border-ink shadow-hard-sm",
      )}
      data-testid={`fb-draft-${draft.n}`}
    >
      <div className="flex items-center justify-between">
        <p className="eyebrow text-ink-muted">Draft {draft.n}</p>
        {draft.notes ? (
          <span
            className={cx(
              "fb-stamp rounded-sm border-2 px-1.5 font-mono text-[11px] font-bold uppercase",
              draft.passed
                ? "border-ivy text-ivy"
                : "border-seal-red text-seal-red",
            )}
          >
            {draft.passed ? "Cleared" : "Sent back"}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">
        {pieces.map((piece, index) =>
          // Pieces of one fixed diff: their position is their identity.
          piece.kind === "gone" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: see above.
            <span key={index} className="fb-gone text-ink-muted">
              {piece.text}
            </span>
          ) : piece.kind === "new" ? (
            <motion.span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed diff.
              key={index}
              initial={{ backgroundColor: "rgba(111,160,220,0)" }}
              animate={{ backgroundColor: "rgba(111,160,220,0.35)" }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              {piece.text}
            </motion.span>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed diff.
            <span key={index}>
              {piece.text.split(/(\s+)/).map((word, w) =>
                struck.has(word.toLowerCase().replace(/[.,;:!?'"]+$/, "")) ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: words of a fixed draft.
                  <mark key={w} className="bg-seal-red/20 text-seal-red">
                    {word}
                  </mark>
                ) : (
                  word
                ),
              )}
            </span>
          ),
        )}
      </p>
      {draft.notes ? (
        <ul className="mt-3 grid gap-1 sm:grid-cols-2">
          {draft.notes.map((note, index) => (
            <motion.li
              key={note.check}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.07 }}
              className={cx(
                "flex items-start gap-1.5 text-xs",
                note.ok ? "text-ivy" : "text-seal-red",
              )}
            >
              <span className="font-mono font-bold">{note.ok ? "✓" : "✗"}</span>
              <span>
                {note.label}
                {!note.ok && note.fix ? (
                  <span className="block text-ink-muted">{note.fix}</span>
                ) : null}
              </span>
            </motion.li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">Code is checking it…</p>
      )}
    </motion.div>
  );
}

/**
 * The After-Action Review. The grade, the heat line, the Rules and the
 * Gauges are code's; the Statement and the lessons are the Comms lead's,
 * and the Statement is sent back until code clears it.
 */
export function Review({
  scenario,
  state,
  debrief,
  onAgain,
  onLobby,
}: {
  scenario: Scenario;
  state: DrillState;
  debrief: Debrief;
  onAgain: () => void;
  onLobby: () => void;
}) {
  const card = debrief.scorecard;
  if (!card)
    return (
      <div className="flex min-h-80 items-center justify-center text-sm text-ink-muted">
        Code is grading the drill…
      </div>
    );
  return (
    <div
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
      data-testid="fb-review"
    >
      <div className="flex flex-col gap-4">
        <div className="relative flex items-center gap-5 rounded-sm border-2 border-ink bg-paper p-4 shadow-hard-md">
          <motion.div
            initial={{ scale: 3, rotate: -24, opacity: 0 }}
            animate={{ scale: 1, rotate: -8, opacity: 1 }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 14,
              delay: 0.2,
            }}
            className={cx(
              "flex h-24 w-24 shrink-0 items-center justify-center rounded-sm border-4 text-6xl font-black",
              GRADE_COLOR[card.grade],
            )}
            data-testid="fb-grade"
          >
            {card.grade}
          </motion.div>
          <div>
            <p className="eyebrow text-ink-muted">
              After-Action Review · {scenario.company}
            </p>
            <p className="mt-1 text-xl font-bold leading-tight text-ink">
              {GRADE_WORDS[card.grade]}
            </p>
            <p className="mt-2 font-mono text-xs text-ink-muted">
              Score {card.score} · peak heat {Math.round(card.peak.heat)} at T+
              {card.peak.hour}h ·{" "}
              {card.containedAt !== null
                ? `contained by T+${card.containedAt}h`
                : "never contained"}{" "}
              · Ƒ{card.cost.toFixed(1)}m · share {card.share.toFixed(1)}
            </p>
          </div>
        </div>
        <div className="rounded-sm border-2 border-ink bg-paper p-3">
          <p className="eyebrow mb-1 text-ink-muted">Heat, hour by hour</p>
          <HeatChart card={card} hours={scenario.hours} />
        </div>
        <div className="rounded-sm border-2 border-ink bg-paper p-3">
          <p className="eyebrow mb-2 text-ink-muted">
            Where each of them ended
          </p>
          <ul className="flex flex-col gap-1.5">
            {GAUGES.map((gauge, index) => {
              const start = scenario.start[gauge];
              const end = state.gauges[gauge];
              const person = scenario.stakeholders.find(
                (s) => s.gauge === gauge,
              );
              return (
                <li
                  key={gauge}
                  className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs"
                >
                  <span className="truncate font-semibold">
                    {GAUGE_WORDS[gauge]}
                  </span>
                  <span
                    className="relative h-3 rounded-sm bg-limestone"
                    title={person?.name}
                  >
                    <span
                      className="absolute top-0 h-3 border-ink border-r-2"
                      style={{ left: `${start}%` }}
                    />
                    <motion.span
                      className={cx(
                        "absolute top-0 left-0 h-3 rounded-sm",
                        end >= start ? "bg-ivy" : "bg-seal-red",
                      )}
                      initial={{ width: `${start}%` }}
                      animate={{ width: `${end}%` }}
                      transition={{ delay: 0.3 + index * 0.1, duration: 0.9 }}
                    />
                  </span>
                  <span className="text-right font-mono font-bold">
                    {end}
                    <span
                      className={end >= start ? "text-ivy" : "text-seal-red"}
                    >
                      {" "}
                      {end - start >= 0 ? "+" : ""}
                      {end - start}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-sm border-2 border-ink bg-paper p-3">
          <p className="eyebrow mb-2 text-ink-muted">
            The Rulebook, checked by code
          </p>
          <RulesStrip findings={card.findings} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-sm border-2 border-ink bg-marble p-3">
          <p className="eyebrow text-ink-muted">
            The public Statement · drafted by Qwen4-Max, cleared only by code ·{" "}
            {STATEMENT_WORDS} words max
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {debrief.drafts.map((draft, index) => (
              <DraftView
                key={draft.n}
                draft={draft}
                previous={debrief.drafts[index - 1] ?? null}
              />
            ))}
            {!debrief.done ? (
              <p className="text-sm text-ink-muted">
                {debrief.drafts.length === 0
                  ? "The Comms lead is drafting…"
                  : "The Comms lead is revising…"}
              </p>
            ) : (
              <p
                className={cx(
                  "text-sm font-semibold",
                  debrief.passed ? "text-ivy" : "text-seal-red",
                )}
              >
                {debrief.passed
                  ? `Cleared on draft ${debrief.drafts.length}.`
                  : `Still not clear after ${debrief.drafts.length} drafts: a person would take it from here.`}
              </p>
            )}
          </div>
        </div>
        {debrief.lessons.length ? (
          <div className="rounded-sm border-2 border-ink bg-ink p-4 text-paper">
            <p className="eyebrow text-brass">Three lessons for the board</p>
            <ol className="mt-2 flex flex-col gap-2">
              {debrief.lessons.map((lesson, index) => (
                <motion.li
                  key={lesson}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.25 }}
                  className="flex gap-2 text-sm leading-snug"
                >
                  <span className="font-mono font-bold text-brass">
                    {index + 1}
                  </span>
                  {lesson}
                </motion.li>
              ))}
            </ol>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onAgain}>
            Run it again
          </Button>
          <Button onClick={onLobby}>Another company</Button>
        </div>
      </div>
    </div>
  );
}
