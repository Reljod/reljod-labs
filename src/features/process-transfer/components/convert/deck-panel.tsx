"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Frames, FrameUrls } from "../../domain/frames";
import {
  type Approval,
  type DeckRound,
  isOver,
  type RunView,
} from "../../domain/run";
import { redoDeck } from "../api";
import { ConfirmDialog } from "../confirm-dialog";
import { DeckPlayer } from "../deck/slide-view";
import {
  emptyChecksLine,
  firstRoundLine,
  maxRounds,
  ROUND_BY,
  redoWarning,
  roundDiff,
  roundLabel,
  roundStats,
  slideIndexFor,
  slideName,
} from "../deck-rounds";
import { exportName } from "../download";
import { plural, when } from "../format";
import { frameTimes } from "../frame-times";
import {
  focusRing,
  InlineError,
  Panel,
  quietButtonClass,
  Skeleton,
  StatusMark,
} from "../ui";
import { ChecksList, checksLine, FindingsList } from "./checks-list";
import { ExportButton } from "./export-button";

/** The PPTX builder (and fflate) load only when a download is near. */
const loadPptx = () => import("../../domain/pptx");
const preparePptx = () => void loadPptx().catch(() => {});

/**
 * The Deck and the loop that made it: a strip of Rounds (what failed in each
 * and what the next one fixed), the player for the selected Round, its
 * Checks and Findings, and the Approval with the PPTX download and Redo.
 */
export function DeckPanel({
  run,
  urls,
  capture,
  progress,
  currentRulesVersion,
  onRedone,
}: {
  run: RunView;
  urls: FrameUrls;
  capture: (times: number[]) => Promise<Frames>;
  progress: { done: number; total: number };
  /** The Owner's Rules version now, which a Redo would use. */
  currentRulesVersion: number;
  onRedone: (runId: string) => void;
}) {
  const rounds = run.rounds;
  const last = rounds.at(-1) ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  // Follow the newest Round unless the person picked one.
  const selected = rounds.find((round) => round.round === picked) ?? last;
  /** A slide a Check pointed at, in a Round; `n` remounts the player at it. */
  const [jump, setJump] = useState({ round: 0, index: 0, n: 0 });
  const player = useRef<HTMLDivElement>(null);

  const times = useMemo(() => frameTimes(null, rounds), [rounds]);
  useEffect(() => {
    if (times.length > 0) void capture(times);
  }, [times, capture]);

  const designState = run.stages.find((stage) => stage.id === "design")?.status;

  if (!selected) {
    if (isOver(run.status)) {
      return (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            This Run ended before a Deck was made.
            {run.error ? ` ${run.error}` : ""}
          </p>
          {run.process ? (
            <RedoBox
              run={run}
              currentRulesVersion={currentRulesVersion}
              onRedone={onRedone}
            />
          ) : null}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <p className="text-sm text-ink-muted">
          {designState === "running"
            ? "A model is planning the slides; the layout engine places every element and gives it an entrance."
            : "The Deck is designed once the Process is written and verified. Each Round of Design and Check shows here."}
        </p>
        <Skeleton lines={4} />
        <div className="ho-shimmer aspect-video w-full rounded-sm" />
      </div>
    );
  }

  const deck = selected.deck;
  const target = {
    name: (id: string | null) => slideName(deck, id),
    go: (id: string) => {
      const index = slideIndexFor(deck, id);
      if (index === null) return;
      setJump((current) => ({
        round: selected.round,
        index,
        n: current.n + 1,
      }));
      player.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  };
  const previous =
    rounds.find((round) => round.round === selected.round - 1) ?? null;
  const deckRules = run.rules.filter((rule) => rule.group !== "process");
  const approval = run.approval;
  const approvedRound =
    approval?.status === "approved"
      ? rounds.find((round) => round.round === approval.round)
      : null;

  return (
    <div className="flex flex-col gap-5">
      <RoundStrip
        rounds={rounds}
        selected={selected.round}
        onSelect={setPicked}
        approval={approval}
        limit={maxRounds(run.rules)}
        running={!isOver(run.status)}
      />

      <ApprovalBox
        run={run}
        approval={approval}
        approvedRound={approvedRound ?? null}
        times={times}
        capture={capture}
        progress={progress}
        currentRulesVersion={currentRulesVersion}
        onRedone={onRedone}
      />

      <WhatChanged round={selected} previous={previous} rules={run.rules} />

      <div ref={player} className="min-w-0">
        <DeckPlayer
          key={`${selected.round}-${jump.n}`}
          deck={deck}
          frames={urls}
          initialSlide={jump.round === selected.round ? jump.index : 0}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          eyebrow={`Checks · Round ${selected.round}`}
          title={
            emptyChecksLine(selected.checks, isOver(run.status)) ??
            checksLine(selected.checks)
          }
        >
          <ChecksList
            checks={selected.checks}
            rules={deckRules.length > 0 ? deckRules : run.rules}
            target={target}
            empty={
              isOver(run.status)
                ? "Every Deck Rule was switched off when this Round ran, so no Check measured it. Turn Rules back on in the Rules tab and redo the Deck."
                : "The Checks run once the Round is laid out."
            }
          />
        </Panel>
        <Panel
          eyebrow={`Reviewer · Round ${selected.round}`}
          title="Findings on the Deck"
        >
          <FindingsList findings={selected.findings} target={target} />
        </Panel>
      </div>
    </div>
  );
}

/** One card per Round, linked by "sent back" arrows, ending in the Approval. */
function RoundStrip({
  rounds,
  selected,
  onSelect,
  approval,
  limit,
  running,
}: {
  rounds: DeckRound[];
  selected: number;
  onSelect: (round: number) => void;
  approval: Approval | null;
  limit: number | null;
  running: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow text-ink-muted">
        Design ⇄ Check · {plural(rounds.length, "Round")}
        {limit ? ` of at most ${limit}` : ""} · pick one to see it
      </p>
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <ol className="flex min-w-max items-stretch gap-1">
          {rounds.map((round, index) => {
            const stats = roundStats(round);
            const active = round.round === selected;
            const tone = round.passed
              ? "pass"
              : stats.blocking + stats.major > 0
                ? "fail"
                : "warn";
            return (
              <Fragment key={round.round}>
                {index > 0 ? (
                  <li
                    aria-hidden="true"
                    className="flex w-10 flex-col items-center justify-center text-ink-muted"
                  >
                    <span className="font-mono text-[9px] tracking-[0.06em] uppercase">
                      sent back
                    </span>
                    <span className="text-lg leading-none">→</span>
                  </li>
                ) : null}
                <li>
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={`${roundLabel(round)}, ${ROUND_BY[round.by]}`}
                    onClick={() => onSelect(round.round)}
                    className={`outline-box flex h-full w-44 flex-col gap-1.5 rounded-sm p-2.5 text-left transition-[box-shadow,background-color] ${focusRing} ${active ? "bg-morning-haze shadow-hard-md" : "bg-paper hover:bg-marble"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold tracking-[0.08em] uppercase">
                        Round {round.round}
                      </span>
                      <StatusMark
                        tone={tone}
                        size="sm"
                        label={round.passed ? "Passed" : "Failed"}
                      />
                    </span>
                    <span className="font-mono text-[10px] text-ink-muted uppercase">
                      {ROUND_BY[round.by]}
                    </span>
                    <span className="flex flex-wrap gap-1 text-[11px]">
                      <Count n={stats.blocking} label="blocking" tone="fail" />
                      <Count
                        n={stats.warnings}
                        label={stats.warnings === 1 ? "warning" : "warnings"}
                        tone="warn"
                      />
                      <Count n={stats.major} label="major" tone="fail" />
                      <Count n={stats.minor} label="minor" tone="warn" />
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {round.deck.slides.length} slides · {stats.passedChecks}/
                      {stats.checks} Checks
                    </span>
                  </button>
                </li>
              </Fragment>
            );
          })}
          <li
            aria-hidden="true"
            className="flex w-8 items-center justify-center text-lg text-ink-muted"
          >
            →
          </li>
          <li className="flex items-center">
            {approval ? (
              <span
                className={`ho-stamp inline-block rounded-sm border-4 px-3 py-1.5 font-mono text-sm font-bold tracking-[0.16em] uppercase ${approval.status === "approved" ? "border-ivy text-ivy" : "border-seal-red text-seal-red"}`}
              >
                {approval.status === "approved" ? "Approved" : "Held"}
              </span>
            ) : (
              <span className="rounded-sm border-2 border-ink/30 border-dashed px-3 py-1.5 font-mono text-xs text-ink-muted uppercase">
                {running ? "Approval pending" : "No Approval"}
              </span>
            )}
          </li>
        </ol>
      </div>
    </div>
  );
}

function Count({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: "fail" | "warn";
}) {
  if (n === 0) return null;
  return (
    <span
      className={`rounded-sm px-1 font-mono font-bold ${tone === "fail" ? "bg-seal-red/10 text-seal-red" : "bg-brass/20 text-oak"}`}
    >
      {n} {label}
    </span>
  );
}

/** "Round 2 fixed: Few points per slide. Still failing: Text fits its box." */
function WhatChanged({
  round,
  previous,
  rules,
}: {
  round: DeckRound;
  previous: DeckRound | null;
  rules: RunView["rules"];
}) {
  const title = (id: string) =>
    rules.find((rule) => rule.id === id)?.title ?? id;
  if (!previous) {
    return (
      <p className="text-sm">
        <span className="font-semibold">
          Round {round.round}, {ROUND_BY[round.by].toLowerCase()}.
        </span>{" "}
        {firstRoundLine(round, title)}
      </p>
    );
  }
  const diff = roundDiff(previous, round);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-semibold">
        Round {round.round}, {ROUND_BY[round.by].toLowerCase()}, after Round{" "}
        {previous.round} was sent back:
      </p>
      <ul className="flex flex-col gap-0.5">
        {diff.fixed.length > 0 ? (
          <li>
            <span className="font-mono text-[11px] font-bold text-ivy uppercase">
              Fixed ·{" "}
            </span>
            {diff.fixed.map(title).join(", ")}
          </li>
        ) : null}
        {diff.still.length > 0 ? (
          <li>
            <span className="font-mono text-[11px] font-bold text-seal-red uppercase">
              Still failing ·{" "}
            </span>
            {diff.still.map(title).join(", ")}
          </li>
        ) : null}
        {diff.fresh.length > 0 ? (
          <li>
            <span className="font-mono text-[11px] font-bold text-oak uppercase">
              Newly failing ·{" "}
            </span>
            {diff.fresh.map(title).join(", ")}
          </li>
        ) : null}
        {diff.fixed.length + diff.still.length + diff.fresh.length === 0 ? (
          <li className="text-ink-muted">
            No Rule changed between the two Rounds; the reviewer&apos;s Findings
            did.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function ApprovalBox({
  run,
  approval,
  approvedRound,
  times,
  capture,
  progress,
  currentRulesVersion,
  onRedone,
}: {
  run: RunView;
  approval: Approval | null;
  approvedRound: DeckRound | null;
  times: number[];
  capture: (times: number[]) => Promise<Frames>;
  progress: { done: number; total: number };
  currentRulesVersion: number;
  onRedone: (runId: string) => void;
}) {
  const approved = approval?.status === "approved" && approvedRound;
  const title = run.process?.title ?? run.title;
  return (
    <section
      aria-labelledby="ho-approval"
      className={`outline-box flex flex-col gap-4 rounded-sm p-4 shadow-hard-md ${approval?.status === "approved" ? "bg-ivy/10" : approval?.status === "held" ? "bg-seal-red/5" : "bg-paper"}`}
    >
      <div className="flex flex-wrap items-start gap-4">
        {approval ? (
          <span
            className={`ho-stamp inline-block shrink-0 rounded-sm border-4 bg-paper px-4 py-2 font-mono text-xl font-bold tracking-[0.2em] uppercase ${approval.status === "approved" ? "border-ivy text-ivy" : "border-seal-red text-seal-red"}`}
          >
            {approval.status === "approved" ? "Approved" : "Held"}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-muted">Approval</p>
          <h3 id="ho-approval" className="font-semibold">
            {approval
              ? approval.status === "approved"
                ? `Round ${approval.round} approved`
                : `Held for a person after Round ${approval.round}`
              : isOver(run.status)
                ? "No verdict: the Run ended first"
                : "Waiting for the last Round"}
          </h3>
          {approval ? (
            <p className="mt-1 text-sm">
              {approval.reason}{" "}
              <span className="text-ink-muted">({when(approval.at)})</span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <ExportButton
          runId={run.id}
          kind="pptx"
          label="Download .pptx"
          fileName={exportName(title, "pptx")}
          times={times}
          capture={capture}
          progress={progress}
          disabledReason={
            approved
              ? null
              : approval?.status === "held"
                ? "Only an approved Deck downloads. Adjust the Rules that held it, or loosen their Parameters, then redo the Deck."
                : "The Deck downloads once it is approved."
          }
          prepare={preparePptx}
          build={async (frames) =>
            approvedRound
              ? (await loadPptx()).buildPptx(approvedRound.deck, {
                  frames,
                  approved: true,
                  createdAt: run.completedAt ?? run.createdAt,
                })
              : new Uint8Array()
          }
        />
        {isOver(run.status) && run.process ? (
          <RedoBox
            run={run}
            currentRulesVersion={currentRulesVersion}
            onRedone={onRedone}
          />
        ) : null}
      </div>
    </section>
  );
}

/** Runs Design, Check and Approve again under the current Rules. Sends once. */
function RedoBox({
  run,
  currentRulesVersion,
  onRedone,
}: {
  run: RunView;
  currentRulesVersion: number;
  onRedone: (runId: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const busy = useRef(false);
  const warning = redoWarning(run.approval);

  /** Sends the Redo once; the result is shown where it was asked for. */
  const send = async (): Promise<{ done: string } | { error: string }> => {
    if (busy.current) return { error: "The Redo is already on its way." };
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await redoDeck(run.id);
      if (result.ok) {
        onRedone(result.value);
        return { done: "The Redo has started." };
      }
      setError(result.error);
      return { error: result.error };
    } catch {
      const message = "The Redo did not reach the server. Try again.";
      setError(message);
      return { error: message };
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const ask = () => {
    if (warning) setConfirming(true);
    else void send();
  };

  const same = currentRulesVersion === run.rulesVersion;
  return (
    <div className="flex max-w-md flex-col items-start gap-2">
      <button
        type="button"
        onClick={ask}
        disabled={pending}
        aria-busy={pending}
        className={quietButtonClass}
      >
        {pending ? "Starting the Redo…" : "Redo deck with current Rules"}
      </button>
      <p className="text-sm text-ink-muted">
        This Run used Rules version {run.rulesVersion}.{" "}
        {same
          ? "Your Rules have not changed since; change them in the Rules tab first, or redo to try again."
          : `A Redo uses your current Rules, version ${currentRulesVersion}.`}{" "}
        Calls the models again.
      </p>
      {confirming ? null : <InlineError>{error}</InlineError>}
      {confirming && warning ? (
        <ConfirmDialog
          id={`ho-redo-${run.id}`}
          title="Redo the Deck"
          confirm="Redo deck"
          pending="Starting the Redo…"
          onConfirm={send}
          onClose={() => setConfirming(false)}
        >
          {warning} It uses your current Rules, version {currentRulesVersion}.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
