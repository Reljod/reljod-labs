/** Formatting helpers for the Operator's screens. Pure. */
import {
  MODELS,
  type ModelId,
  type RunStatus,
  type StopReason,
} from "../domain/contract";

export function usd(value: number) {
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** A length of time in words: `840 ms`, `12.4 s`, `3m 07s`. */
export function duration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** A running clock: `0:07`, `12:40`, `1:02:05`. Never negative. */
export function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function bytes(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} KB`;
  return `${value} B`;
}

export function modelLabel(id: string | null) {
  if (!id) return "no model";
  return MODELS[id as ModelId]?.label ?? id;
}

/** A model's list price in one line. */
export function modelPrice(id: ModelId) {
  const price = MODELS[id];
  return `$${price.input} in, $${price.output} out per million tokens (list price)`;
}

export const DRIVER_LABEL = {
  operator: "The Operator",
  client: "An MCP client",
  hand: "By hand",
} as const;

export const STATUS_WORD: Record<RunStatus, string> = {
  queued: "queued",
  running: "running",
  paused: "paused for a person",
  completed: "finished",
  failed: "failed",
  stopped: "stopped",
};

/** Why a Run ended, in plain words. */
export const STOPPED_BY_LABEL: Record<StopReason, string> = {
  finish: "the Driver said it was done",
  turns: "the Turn limit",
  actions: "the Action limit",
  cost: "the spend limit",
  time: "the time limit",
  idle: "nothing happened for too long",
};

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

export const errorsLabel = (count: number) => plural(count, "error");
