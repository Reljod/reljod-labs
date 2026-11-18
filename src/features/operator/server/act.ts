import "server-only";
import { randomUUID } from "node:crypto";
import { actionLabel, type ScreenAction } from "../domain/actions";
import { progressOf } from "../domain/checks";
import type { PendingApproval, RunEventInput } from "../domain/contract";
import { describeChange } from "../domain/guard";
import { LIMITS } from "../domain/limits";
import type { Change, ScreenCode } from "../legacy/types";
import {
  type Counters,
  expectedOf,
  metricsFrom,
  type RunContext,
} from "./context";
import { emit } from "./emit";
import { insertApproval, moveRun, updateRun } from "./repository";
import type { Blocked } from "./sandbox/protocol";
import { screenAct } from "./screen";
import { putFrame } from "./storage";

/*
 * The one path an Action takes, whoever drives (ADR 0025): the workflow's
 * step for the in-app Operator and the MCP tools for an outside client both
 * call `performAction`. It checks the cap, sends the Action to the Screen
 * sandbox (where the Guard sees every key first), stores the Frame and
 * writes the Trail.
 */

export type ActOutcome = {
  /** The Frame that shows the Screen after the Action; null when nothing was done. */
  frame: number | null;
  screen: ScreenCode | null;
  message: string;
  /** What the driver is told. */
  text: string;
  /** Set when the Guard stopped an input of the Action. */
  blocked: Blocked | null;
  /** The Books against the Fixture, when the Action committed something. */
  diff: Change[] | null;
  counters: Counters;
  /** The Run reached its Action cap: nothing was done. */
  capped: boolean;
};

/** One line that stands in for a picture dropped from the Operator's context. */
export const frameHint = (screen: ScreenCode | null, message: string) =>
  `${screen ?? "unknown Screen"}${message ? `, message line "${message}"` : ""}`;

export async function performAction(
  ctx: RunContext,
  counters: Counters,
  at: { turn: number; intent: string },
  action: ScreenAction | null,
  skip = 0,
): Promise<ActOutcome> {
  if (action && counters.actions >= LIMITS.actionsPerRun) {
    return {
      frame: null,
      screen: null,
      message: "",
      text: `Not done: this Run has used its ${LIMITS.actionsPerRun} Actions.`,
      blocked: null,
      diff: null,
      counters,
      capped: true,
    };
  }
  const result = await screenAct(ctx.runId, ctx.secret, { action, skip });
  const n = counters.frames;
  await putFrame(ctx.runId, n, Buffer.from(result.png, "base64"));

  const label = action
    ? actionLabel(action)
    : n === 0
      ? "sign-on Screen"
      : "look";
  const events: RunEventInput[] = [
    {
      type: "frame",
      n,
      turn: at.turn,
      action,
      label,
      intent: at.intent,
      screen: result.screen,
      pointer: result.pointer,
      caret: result.caret,
      changes: result.changes,
      message: result.message,
      ms: result.ms,
    },
  ];
  const blocked = result.blocked;
  if (blocked)
    events.push({
      type: "rule",
      ruleId: blocked.decision.ruleId,
      outcome: blocked.decision.kind === "pause" ? "paused" : "refused",
      reason: blocked.decision.reason,
      label: `${label} (${blocked.input})`,
      screen: result.screen,
      frame: n,
    });
  const expected = expectedOf(ctx.taskId);
  if (result.diff && expected)
    events.push({ type: "progress", met: progressOf(expected, result.diff) });
  await emit(ctx.runId, ...events);

  const next: Counters = {
    ...counters,
    frames: n + 1,
    // A resumed Action (after a pause) was already counted.
    actions: counters.actions + (action && skip === 0 ? 1 : 0),
    records: result.records,
    errors: result.errors,
    refusals: counters.refusals + (blocked?.decision.kind === "refuse" ? 1 : 0),
  };
  const text = !blocked
    ? action
      ? "Done. The Screen now is in the picture."
      : "The Screen now is in the picture."
    : blocked.decision.kind === "refuse"
      ? `REFUSED by the Rule ${blocked.decision.ruleId}: ${blocked.decision.reason} The input (${blocked.input}) did not reach HARBOURMASTER${blocked.applied > 0 ? `; the ${blocked.applied} input(s) before it in this Action did` : ""}. Do not try to make the same change another way.`
      : `PAUSED by the Rule ${blocked.decision.ruleId}: ${blocked.decision.reason}`;
  return {
    frame: n,
    screen: result.screen,
    message: result.message,
    text,
    blocked,
    diff: result.diff,
    counters: next,
    capped: false,
  };
}

/**
 * Opens an Approval for a guarded Action the Guard stopped: the row, the
 * `pause` event, and the Run goes to `paused`. A person decides it; the
 * driver never does. Null when the Run ended meanwhile.
 */
export async function openApproval(
  ctx: RunContext,
  counters: Counters,
  outcome: ActOutcome,
  hookToken: string | null,
): Promise<{ pending: PendingApproval; counters: Counters } | null> {
  const blocked = outcome.blocked;
  if (!blocked || blocked.decision.kind !== "pause" || outcome.frame === null)
    return null;
  const { decision } = blocked;
  const pending: PendingApproval = {
    approvalId: randomUUID(),
    actionKind: decision.actionKind,
    label: describeChange(decision.change),
    change: decision.change,
    screen: outcome.screen ?? "HMM100",
    key: blocked.input,
    frame: outcome.frame,
    expiresAt: Date.now() + LIMITS.approvalWaitMinutes * 60_000,
  };
  const next = { ...counters, pauses: counters.pauses + 1 };
  await insertApproval({
    id: pending.approvalId,
    runId: ctx.runId,
    fingerprint: decision.fingerprint,
    pending,
    hookToken,
  });
  if (!(await moveRun(ctx.runId, ["running"], "paused"))) return null;
  await updateRun(ctx.runId, { metrics: metricsFrom(next) });
  await emit(ctx.runId, { type: "pause", pending });
  return { pending, counters: next };
}
