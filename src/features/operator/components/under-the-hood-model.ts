import type { ScreenCode } from "../legacy/types";
import {
  type Driver,
  MODELS,
  type ModelId,
  type RunDetail,
  type RunEvent,
  type StopReason,
} from "../domain/contract";
import { describeChange } from "../domain/guard";
import { LIMITS } from "../domain/limits";
import { ruleInfo, type RuleId } from "../domain/rules";

/**
 * What "Under the hood" shows about one Run, derived from the Run alone
 * (its row and its Trail) by pure functions. The component only lays it out.
 */

type Of<T extends RunEvent["type"]> = Extract<RunEvent, { type: T }>;

const eventsOf = <T extends RunEvent["type"]>(
  events: readonly RunEvent[],
  type: T,
) => events.filter((event): event is Of<T> => event.type === type);

// Formats ---------------------------------------------------------------------------------

export const usd = (value: number) => `$${value.toFixed(4)}`;

export const count = (value: number) => value.toLocaleString("en-GB");

/** `840 ms`, `12.4 s`, `3 min 05 s`. */
export function duration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

export const DRIVER_LABELS: Record<Driver, string> = {
  operator: "The Operator",
  client: "An outside MCP client",
  hand: "A person, by hand",
};

export function modelLabel(model: string | null) {
  if (!model) return "None";
  return MODELS[model as ModelId]?.label ?? model;
}

// Tiles -----------------------------------------------------------------------------------

export type Tile = { label: string; value: string; hint?: string };

export function tilesOf(run: RunDetail): Tile[] {
  const m = run.metrics;
  return [
    { label: "Turns", value: count(m.turns), hint: "model calls" },
    { label: "Actions", value: count(m.actions) },
    { label: "Frames", value: count(m.frames) },
    { label: "Records committed", value: count(m.records) },
    { label: "Refusals", value: count(m.refusals), hint: "by a Rule" },
    { label: "Pauses", value: count(m.pauses), hint: "for a person" },
    {
      label: "HARBOURMASTER errors",
      value: count(m.errors),
      hint: "error messages",
    },
    { label: "Tokens in", value: count(m.inputTokens) },
    { label: "Tokens cached", value: count(m.cachedInputTokens) },
    { label: "Tokens out", value: count(m.outputTokens) },
    { label: "Cost", value: usd(run.costUsd), hint: "USD" },
    { label: "Wall time", value: duration(m.ms) },
    { label: "Model", value: modelLabel(run.model) },
    {
      label: "Rulebook",
      value: `v${run.rulebookVersion}`,
      hint: run.rulebookVersion === 0 ? "the Default" : undefined,
    },
    { label: "Driver", value: DRIVER_LABELS[run.driver] },
  ];
}

// Actions ---------------------------------------------------------------------------------

export type ActionRow = {
  n: number;
  turn: number;
  label: string;
  intent: string;
  screen: ScreenCode;
  ms: number;
  /** What it committed, in plain words; empty when nothing. */
  committed: string[];
  message: string;
  slowest: boolean;
};

/** One row per Action, from the `frame` events (Frame 0, the sign-on Screen, is no Action). */
export function actionRowsOf(events: readonly RunEvent[]): ActionRow[] {
  const frames = eventsOf(events, "frame").filter(
    (frame) => frame.action !== null,
  );
  const top = frames.reduce((max, frame) => Math.max(max, frame.ms), 0);
  const slowestAt =
    top > 0 ? frames.findIndex((frame) => frame.ms === top) : -1;
  return frames.map((frame, index) => ({
    n: frame.n,
    turn: frame.turn,
    label: frame.label,
    intent: frame.intent,
    screen: frame.screen,
    ms: frame.ms,
    committed: frame.changes.map(describeChange),
    message: frame.message,
    slowest: index === slowestAt,
  }));
}

// Model calls -----------------------------------------------------------------------------

export type ModelCall = {
  turn: number;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  /** This call's time as a share of the slowest call, 0 to 1, for the bar. */
  share: number;
};

export function modelCallsOf(events: readonly RunEvent[]): ModelCall[] {
  const calls = eventsOf(events, "cost");
  const top = calls.reduce((max, call) => Math.max(max, call.ms), 0);
  return calls.map((call) => ({
    turn: call.turn,
    model: call.model,
    inputTokens: call.inputTokens,
    cachedInputTokens: call.cachedInputTokens,
    outputTokens: call.outputTokens,
    costUsd: call.costUsd,
    ms: call.ms,
    share: top > 0 ? call.ms / top : 0,
  }));
}

// Rules that fired ------------------------------------------------------------------------

export type FiredRule = {
  seq: number;
  ruleId: RuleId;
  title: string;
  outcome: "refused" | "paused";
  reason: string;
  /** The Action it stopped. */
  label: string;
  screen: ScreenCode;
  frame: number;
  /** For a pause: what the person decided and how long it took. */
  pause: {
    decision: "approved" | "refused" | "expired" | "waiting";
    note?: string;
    /** ms from the pause to the decision; null while it waits. */
    waitedMs: number | null;
  } | null;
};

/**
 * Every Rule that fired, in Trail order. A pausing Rule is paired with the
 * first `pause` event after it, and that pause with its `decision` by Approval id.
 */
export function firedRulesOf(events: readonly RunEvent[]): FiredRule[] {
  const pauses = eventsOf(events, "pause");
  const decisions = eventsOf(events, "decision");
  const used = new Set<number>();
  return eventsOf(events, "rule").map((rule) => {
    let pause: FiredRule["pause"] = null;
    if (rule.outcome === "paused") {
      const match = pauses.find(
        (event) => event.seq > rule.seq && !used.has(event.seq),
      );
      if (match) {
        used.add(match.seq);
        const decided = decisions.find(
          (event) => event.approvalId === match.pending.approvalId,
        );
        pause = decided
          ? {
              decision: decided.decision,
              note: decided.note,
              waitedMs: Math.max(0, decided.at - match.at),
            }
          : { decision: "waiting", waitedMs: null };
      } else {
        pause = { decision: "waiting", waitedMs: null };
      }
    }
    return {
      seq: rule.seq,
      ruleId: rule.ruleId,
      title: ruleInfo(rule.ruleId)?.title ?? rule.ruleId,
      outcome: rule.outcome,
      reason: rule.reason,
      label: rule.label,
      screen: rule.screen,
      frame: rule.frame,
      pause,
    };
  });
}

// Why it stopped --------------------------------------------------------------------------

export const STOP_REASONS: Record<StopReason, string> = {
  finish: "The driver said the Task was done, so the harness ran the checks.",
  turns: `The harness stopped it at the Turn cap (${LIMITS.turnsPerRun} model calls).`,
  actions: `The harness stopped it at the Action cap (${LIMITS.actionsPerRun} Actions).`,
  cost: `The harness stopped it at the spend cap ($${LIMITS.usdPerRun.toFixed(2)} a Run).`,
  time: `The harness stopped it at the time cap (${LIMITS.sandboxMinutes} minutes of Screen sandbox).`,
  idle: "The harness stopped it because the driver went quiet.",
};

export type Cap = {
  label: string;
  used: string;
  limit: string;
  /** 0 to 1, for the bar. */
  share: number;
  /** This cap is what ended the Run. */
  hit: boolean;
};

export type Stop = {
  /** One plain sentence. */
  headline: string;
  /** The error or the driver's summary, as recorded. */
  detail: string | null;
  caps: Cap[];
};

const share = (used: number, limit: number) =>
  limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;

export function stopOf(run: RunDetail): Stop {
  const end = eventsOf(run.events, "end").at(-1);
  const stoppedBy = run.stoppedBy ?? end?.stoppedBy ?? null;
  const m = run.metrics;
  const sandboxMs = LIMITS.sandboxMinutes * 60_000;
  const caps: Cap[] = [
    {
      label: "Turns",
      used: count(m.turns),
      limit: count(LIMITS.turnsPerRun),
      share: share(m.turns, LIMITS.turnsPerRun),
      hit: stoppedBy === "turns",
    },
    {
      label: "Actions",
      used: count(m.actions),
      limit: count(LIMITS.actionsPerRun),
      share: share(m.actions, LIMITS.actionsPerRun),
      hit: stoppedBy === "actions",
    },
    {
      label: "Spend",
      used: usd(run.costUsd),
      limit: usd(LIMITS.usdPerRun),
      share: share(run.costUsd, LIMITS.usdPerRun),
      hit: stoppedBy === "cost",
    },
    {
      label: "Wall time",
      used: duration(m.ms),
      limit: `${LIMITS.sandboxMinutes} min`,
      share: share(m.ms, sandboxMs),
      hit: stoppedBy === "time",
    },
    {
      label: "Code runs",
      used: count(m.codeRuns),
      limit: count(LIMITS.codeRunsPerRun),
      share: share(m.codeRuns, LIMITS.codeRunsPerRun),
      hit: false,
    },
  ];

  let headline: string;
  if (run.status === "queued") headline = "Queued: the Run has not started.";
  else if (run.status === "running") headline = "Still running.";
  else if (run.status === "paused")
    headline = "Paused: an Action is waiting for a person.";
  else if (run.status === "failed")
    headline = stoppedBy
      ? `Failed. ${STOP_REASONS[stoppedBy]}`
      : "Failed before the driver finished.";
  else if (stoppedBy) headline = STOP_REASONS[stoppedBy];
  else if (run.status === "stopped")
    headline =
      "Stopped before it finished: someone pressed Stop or called stop_run.";
  else headline = "Completed.";

  return {
    headline,
    detail: run.error ?? end?.error ?? end?.summary ?? null,
    caps,
  };
}

// Code ------------------------------------------------------------------------------------

export type CodeRun = {
  callId: string;
  code: string;
  exitCode: number;
  running: boolean;
  stdout: string;
  stderr: string;
  ms: number;
};

/** The code the driver ran, latest state per call (a call is written again when it ends). */
export function codeRunsOf(events: readonly RunEvent[]): CodeRun[] {
  const byCall = new Map<string, CodeRun>();
  for (const event of eventsOf(events, "code")) {
    byCall.set(event.callId, {
      callId: event.callId,
      code: event.code,
      exitCode: event.exitCode,
      running: event.exitCode === -1,
      stdout: event.stdout,
      stderr: event.stderr,
      ms: event.ms,
    });
  }
  return [...byCall.values()];
}
