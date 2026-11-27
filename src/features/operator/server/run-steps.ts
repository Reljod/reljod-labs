import "server-only";
import type { Change } from "../legacy/types";
import type { Counters, RunContext } from "./context";
import type { ToolCall, TranscriptItem } from "./operator";
import type { ActOutcome, EndOutcome } from "./services/steps";
import { runSteps } from "./steps-container";

/*
 * What the workflow's steps call (run-workflow.ts wraps each in a durable
 * step; their names there are replay keys). Each is the Run steps service of
 * the Run's own mode: a Run the stubbed e2e suite started (`ctx.stubbed`)
 * gets the scripted Operator and the in-process Screen on every step.
 */

export type { CallResult, EndOutcome, Settled } from "./services/steps";

const steps = (ctx: RunContext) => runSteps({ stub: ctx.stubbed });

export const begin = (ctx: RunContext) => steps(ctx).begin(ctx);

export const turn = (
  ctx: RunContext,
  transcript: TranscriptItem[],
  number: number,
) => steps(ctx).turn(ctx, transcript, number);

export const runCall = (
  ctx: RunContext,
  counters: Counters,
  at: { turn: number; intent: string },
  call: ToolCall,
  keyed: Change[],
) => steps(ctx).runCall(ctx, counters, at, call, keyed);

export const resumeCall = (
  ctx: RunContext,
  counters: Counters,
  at: { turn: number; intent: string },
  call: ToolCall,
  skip: number,
) => steps(ctx).resumeCall(ctx, counters, at, call, skip);

export const pause = (
  ctx: RunContext,
  counters: Counters,
  outcome: ActOutcome,
  token: string,
) => steps(ctx).pause(ctx, counters, outcome, token);

export const settle = (
  ctx: RunContext,
  approvalId: string,
  fingerprint: string,
  answer: "approved" | "refused" | null,
) => steps(ctx).settle(ctx, approvalId, fingerprint, answer);

export const saveCounters = (ctx: RunContext, counters: Counters) =>
  steps(ctx).saveCounters(ctx, counters);

export const note = (ctx: RunContext, text: string) =>
  steps(ctx).note(ctx, text);

export const end = (
  ctx: RunContext,
  counters: Counters,
  outcome: EndOutcome,
  startedAt: number,
) => steps(ctx).finish(ctx, counters, outcome, startedAt);
