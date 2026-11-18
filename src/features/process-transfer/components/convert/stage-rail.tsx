"use client";

import { useMemo, useRef, useState } from "react";
import { PURPOSES } from "../../domain/models";
import {
  isOver,
  type RunView,
  STAGES,
  type StageId,
  type StageStatus,
} from "../../domain/run";
import { stopRun } from "../../server/actions";
import {
  costByStage,
  earlierCalls,
  modelLabel,
  roundOfCall,
  stageOfCall,
  totalOf,
} from "../cost";
import { maxRounds } from "../deck-rounds";
import { clockTime, elapsed, plural, usd } from "../format";
import { focusRing, InlineError, quietButtonClass, StatusMark } from "../ui";
import { hasResults } from "./stage-results";

const TONE: Record<
  StageStatus,
  "pass" | "fail" | "running" | "pending" | "skipped"
> = {
  done: "pass",
  failed: "fail",
  running: "running",
  pending: "pending",
  skipped: "skipped",
};

const STATUS_WORD: Record<StageStatus, string> = {
  done: "Done",
  failed: "Failed",
  running: "Running",
  pending: "Waiting",
  skipped: "Skipped",
};

/** The Round Design or Check is on: the highest one any call or result names. */
function currentRound(run: RunView, stage: StageId): number | null {
  if (stage !== "design" && stage !== "check") return null;
  const fromCalls = run.calls
    .filter((call) => stageOfCall(call) === stage)
    .map((call) => roundOfCall(call.label) ?? 0);
  const highest = Math.max(run.rounds.length, ...fromCalls, 0);
  return highest > 0 ? highest : null;
}

/**
 * The seven Stages in order, each with its status, what it found, how long
 * it took, the model it used and what it cost. Design and Check show the
 * Round they are on. A Stage that has started opens its results on click.
 */
export function StageRail({
  run,
  onOpen,
}: {
  run: RunView;
  onOpen?: (stage: StageId) => void;
}) {
  const costs = useMemo(() => costByStage(run.calls), [run.calls]);
  const total = useMemo(() => totalOf(run.calls), [run.calls]);
  const earlier = useMemo(() => totalOf(earlierCalls(run.calls)), [run.calls]);
  const limit = maxRounds(run.rules);
  const states = new Map(run.stages.map((stage) => [stage.id, stage]));
  const totalUsd = Math.max(run.costUsd, total.costUsd);
  const held = run.approval?.status === "held";

  return (
    <div className="flex flex-col">
      <ol aria-label="Stages" className="flex flex-col">
        {STAGES.map((stage, index) => {
          const state = states.get(stage.id);
          // A Stage still "running" on a Run that is over was cut short (stopped or failed).
          const saved: StageStatus = state?.status ?? "pending";
          const status: StageStatus =
            saved === "running" && isOver(run.status)
              ? run.status === "failed"
                ? "failed"
                : "skipped"
              : saved;
          const word =
            saved === "running" && run.status === "stopped"
              ? "Stopped"
              : STATUS_WORD[status];
          const cost = costs[stage.id];
          const round = currentRound(run, stage.id);
          const last = index === STAGES.length - 1;
          const openable = onOpen !== undefined && hasResults(status);
          const name = (
            <>
              {stage.label}
              {round ? (
                <span className="ml-2 font-medium text-federal-blue normal-case tracking-normal">
                  Round {round}
                  {limit ? ` of ${limit}` : ""}
                </span>
              ) : null}
            </>
          );
          const models =
            cost.models.length > 0
              ? cost.models.map(modelLabel).join(", ")
              : stage.purpose
                ? status === "pending" || status === "skipped"
                  ? null
                  : modelLabel(run.models[stage.purpose])
                : "No model";
          return (
            <li key={stage.id} className="relative flex gap-3 pb-3">
              {last ? null : (
                <span
                  aria-hidden="true"
                  className={`absolute top-8 bottom-0 left-[13px] w-0.5 ${status === "running" ? "ho-flow" : status === "done" ? "bg-ink" : "bg-ink/20"}`}
                />
              )}
              <StatusMark
                tone={held && stage.id === "approve" ? "warn" : TONE[status]}
                label={`${stage.label}: ${held && stage.id === "approve" ? "Held" : word}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  {openable ? (
                    <button
                      type="button"
                      onClick={() => onOpen(stage.id)}
                      title={`Show what ${stage.label} made`}
                      className={`rounded-sm text-left font-mono text-sm font-bold tracking-[0.06em] uppercase underline decoration-ink/30 decoration-2 underline-offset-4 hover:text-federal-blue hover:decoration-federal-blue ${focusRing}`}
                    >
                      {name}
                    </button>
                  ) : (
                    <p
                      className={`font-mono text-sm font-bold tracking-[0.06em] uppercase ${status === "pending" ? "text-ink-muted" : ""}`}
                    >
                      {name}
                    </p>
                  )}
                  <p className="font-mono text-[11px] text-ink-muted">
                    {state?.ms ? elapsed(state.ms) : null}
                    {cost.costUsd > 0 ? (
                      <span className="ml-2 font-bold text-ink">
                        {usd(cost.costUsd)}
                      </span>
                    ) : null}
                  </p>
                </div>
                {status === "running" ? (
                  <p className="text-sm text-ink-muted">{stage.does}</p>
                ) : state?.summary ? (
                  <p className="text-sm">{state.summary}</p>
                ) : null}
                {models && status !== "pending" ? (
                  <p className="mt-0.5 hidden font-mono text-[11px] text-ink-muted sm:block">
                    {stage.purpose ? `${PURPOSES[stage.purpose].label}: ` : ""}
                    {models}
                    {cost.calls > 1 ? ` · ${plural(cost.calls, "call")}` : ""}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 border-ink border-t-2 pt-3">
        <p className="eyebrow">
          {isOver(run.status) ? "Total" : "Total so far"}
        </p>
        <p className="font-mono text-sm">
          <span className="text-lg font-bold">{usd(totalUsd)}</span>
          <span className="ml-2 text-ink-muted">
            {plural(total.calls, "model call")}
          </span>
        </p>
        {earlier.calls > 0 ? (
          <p className="w-full text-ink-muted text-xs">
            Includes {usd(earlier.costUsd)} for{" "}
            {plural(earlier.calls, "Design and Check call")} whose Rounds the
            latest Redo replaced.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Stops a running Run. The escape hatch: guarded against a double click, never asks first. */
export function StopButton({ runId }: { runId: string }) {
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const stop = async () => {
    if (busy.current) return;
    busy.current = true;
    setState("pending");
    setError(null);
    try {
      const result = await stopRun(runId);
      if (result.ok) {
        setState("sent");
        return;
      }
      setError(result.error);
      setState("idle");
    } catch {
      setError("The stop did not reach the server. Try again.");
      setState("idle");
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={stop}
        disabled={state !== "idle"}
        aria-busy={state === "pending"}
        className={`${quietButtonClass} text-seal-red`}
      >
        <span aria-hidden="true" className="size-2.5 bg-seal-red" />
        {state === "pending"
          ? "Stopping…"
          : state === "sent"
            ? "Stop sent"
            : "Stop"}
      </button>
      {state === "sent" ? (
        <p aria-live="polite" className="text-xs text-ink-muted">
          Stopping after the current step.
        </p>
      ) : null}
      <InlineError>{error}</InlineError>
    </div>
  );
}

/** What the pipeline wrote while it worked, newest last, in mono. */
export function RunLogList({ logs }: { logs: RunView["logs"] }) {
  const warnings = logs.filter((line) => line.level !== "info").length;
  return (
    <details className="group outline-box rounded-sm bg-paper">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 font-mono text-xs font-bold tracking-[0.1em] uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-federal-blue">
        <span>
          Log{" "}
          <span className="font-medium text-ink-muted">
            · {plural(logs.length, "line")}
          </span>
          {warnings > 0 ? (
            <span className="ml-2 text-seal-red">
              {plural(warnings, "warning")}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className="transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <ol className="max-h-72 overflow-auto border-ink border-t-2 bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-paper/85">
        {logs.length === 0 ? (
          <li className="text-paper/50">Nothing yet.</li>
        ) : null}
        {logs.map((line, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only and have no id
            key={index}
            className={`break-words ${line.level === "error" ? "text-[#ff9a8a]" : line.level === "warn" ? "text-brass" : ""}`}
          >
            <span className="text-paper/45">{clockTime(line.at)} </span>
            {line.text}
          </li>
        ))}
      </ol>
    </details>
  );
}
