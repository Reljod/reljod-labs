import "server-only";
import type { RunEventInput } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import type { Change } from "../legacy/types";
import { skillById } from "../skills";
import { type ActOutcome, frameHint, openApproval, performAction } from "./act";
import { CODE_LIMITS, runCode } from "./code-sandbox";
import {
  type Counters,
  emptyCounters,
  fixtureOf,
  metricsFrom,
  type RunContext,
} from "./context";
import { emit, emitStrict } from "./emit";
import { type EndOutcome, finishRun } from "./finish";
import {
  actionOf,
  isToolName,
  operatorTurn,
  type ToolCall,
  type TranscriptItem,
  type TurnResult,
} from "./operator";
import {
  approvalRow,
  decideApprovalRow,
  moveRun,
  updateRun,
} from "./repository";
import { bootScreen, screenApprove, screenTouch } from "./screen";

/*
 * What the workflow's steps do, as plain functions (run-workflow.ts wraps
 * each in a durable step). Kept apart so they can be read and tested without
 * the workflow runtime.
 */

/** Starts the Screen sandbox and takes Frame 0, the sign-on Screen. */
export async function begin(ctx: RunContext) {
  await updateRun(ctx.runId, { status: "running" });
  await bootScreen({
    runId: ctx.runId,
    fixture: fixtureOf(ctx.taskId),
    rulebook: ctx.rulebook,
    secret: ctx.secret,
  });
  const first = await performAction(
    ctx,
    emptyCounters(),
    { turn: 0, intent: "HARBOURMASTER is up: the sign-on Screen." },
    null,
  );
  return {
    counters: first.counters,
    hint: frameHint(first.screen, first.message),
    startedAt: Date.now(),
  };
}

/** One Turn, with its thought and cost on the Trail. */
export async function turn(
  ctx: RunContext,
  transcript: TranscriptItem[],
  number: number,
): Promise<TurnResult> {
  const result = await operatorTurn(ctx, transcript, number);
  if (result.kind === "over") return result;
  const events: RunEventInput[] = [];
  if (result.text)
    events.push({ type: "thought", turn: number + 1, text: result.text });
  if (result.usage)
    events.push({ type: "cost", turn: number + 1, ...result.usage });
  if (events.length > 0) await emit(ctx.runId, ...events);
  return result;
}

export type CallResult = {
  output: string;
  counters: Counters;
  /** The Frame taken, for a screen call. */
  frame: number | null;
  hint: string | null;
  diff: Change[] | null;
  /** The Guard stopped the Action: the workflow pauses or halts the Turn. */
  outcome: ActOutcome | null;
  /** `finish_run` was called, with this summary. */
  finished?: string;
};

const plain = (output: string, counters: Counters): CallResult => ({
  output,
  counters,
  frame: null,
  hint: null,
  diff: null,
  outcome: null,
});

function fromAct(outcome: ActOutcome): CallResult {
  return {
    output: outcome.text,
    counters: outcome.counters,
    frame: outcome.frame,
    hint:
      outcome.frame === null
        ? null
        : frameHint(outcome.screen, outcome.message),
    diff: outcome.diff,
    outcome: outcome.blocked ? outcome : null,
  };
}

/** Runs one tool call of a Turn. */
export async function runCall(
  ctx: RunContext,
  counters: Counters,
  at: { turn: number; intent: string },
  call: ToolCall,
  keyed: Change[],
): Promise<CallResult> {
  const input = (call.input ?? {}) as Record<string, unknown>;
  if (!isToolName(call.toolName))
    return plain(`Unknown tool ${call.toolName}.`, counters);
  if (typeof input.__invalid === "string")
    return plain(`Not done: invalid input (${input.__invalid}).`, counters);

  switch (call.toolName) {
    case "finish_run":
      return {
        ...plain("Finished. The harness now checks the Books.", counters),
        finished: typeof input.summary === "string" ? input.summary : "",
      };
    case "update_plan": {
      const items = Array.isArray(input.items)
        ? (input.items as { text?: unknown; done?: unknown }[])
            .slice(0, 20)
            .map((item) => ({
              text: String(item.text ?? "").slice(0, 140),
              done: item.done === true,
            }))
        : [];
      await emit(ctx.runId, { type: "plan", items });
      return plain("Plan updated.", counters);
    }
    case "load_skill": {
      const skill = skillById(String(input.id ?? ""));
      if (!skill) return plain("No such Skill.", counters);
      await emit(ctx.runId, {
        type: "skill",
        id: skill.id,
        title: skill.title,
      });
      return plain(skill.body(ctx.rulebook), counters);
    }
    case "run_code": {
      if (counters.codeRuns >= LIMITS.codeRunsPerRun)
        return plain(
          `Not run: this Run has used its ${LIMITS.codeRunsPerRun} code runs.`,
          counters,
        );
      const code = String(input.code ?? "").slice(0, CODE_LIMITS.codeChars);
      if (!code.trim()) return plain("Not run: no code.", counters);
      const pending = {
        type: "code" as const,
        callId: call.toolCallId,
        code,
        exitCode: -1,
        stdout: "",
        stderr: "",
        ms: 0,
      };
      // The Trail first: code the driver wrote never runs untraced.
      await emitStrict(ctx.runId, pending);
      const result = await runCode({
        ctx,
        callId: call.toolCallId,
        code,
        keyed,
      });
      await emit(ctx.runId, { ...pending, ...result });
      return plain(
        `exit ${result.exitCode}\n--- stdout ---\n${result.stdout || "(empty)"}${result.stderr ? `\n--- stderr ---\n${result.stderr}` : ""}`,
        { ...counters, codeRuns: counters.codeRuns + 1 },
      );
    }
    default: {
      const wanted = actionOf(call.toolName, input);
      if ("error" in wanted) return plain(wanted.error, counters);
      return fromAct(await performAction(ctx, counters, at, wanted.action));
    }
  }
}

/** After a person approved: presses the rest of the Action, from the key the Guard stopped. */
export async function resumeCall(
  ctx: RunContext,
  counters: Counters,
  at: { turn: number; intent: string },
  call: ToolCall,
  skip: number,
): Promise<CallResult> {
  const wanted = actionOf(call.toolName, call.input);
  if ("error" in wanted) return plain(wanted.error, counters);
  return fromAct(await performAction(ctx, counters, at, wanted.action, skip));
}

/** Opens the Approval for a paused Action. Null when the Run ended meanwhile. */
export async function pause(
  ctx: RunContext,
  counters: Counters,
  outcome: ActOutcome,
  token: string,
) {
  const opened = await openApproval(ctx, counters, outcome, token);
  if (!opened || outcome.blocked?.decision.kind !== "pause") return null;
  return {
    approvalId: opened.pending.approvalId,
    fingerprint: outcome.blocked.decision.fingerprint,
    counters: opened.counters,
  };
}

export type Settled = {
  decision: "approved" | "refused" | "expired";
  /** False when the Run ended while it waited: nothing more may be keyed. */
  active: boolean;
};

/**
 * Settles a pause. `answer` is the person's decision the hook carried, or
 * null when the wait ran out (the harness then refuses the Action itself).
 * The Guard is told of an approval here, by the harness, never by the driver.
 */
export async function settle(
  ctx: RunContext,
  approvalId: string,
  fingerprint: string,
  answer: "approved" | "refused" | null,
): Promise<Settled> {
  let decision: Settled["decision"];
  if (answer) {
    decision = answer;
  } else if (await decideApprovalRow(ctx.runId, approvalId, "expired")) {
    decision = "expired";
  } else {
    // Decided in the same moment the wait ran out: the person's decision stands.
    const row = await approvalRow(ctx.runId, approvalId);
    decision =
      row?.status === "approved"
        ? "approved"
        : row?.status === "refused"
          ? "refused"
          : "expired";
  }
  // A Run that ended while it waited must not key anything (conventions.md).
  const active = await moveRun(ctx.runId, ["paused"], "running");
  await emit(ctx.runId, { type: "decision", approvalId, decision });
  if (active) {
    if (decision === "approved")
      await screenApprove(ctx.runId, ctx.secret, fingerprint);
    else await screenTouch(ctx.runId, ctx.secret);
  }
  return { decision, active };
}

/** Writes the Run's totals to its row, so the list and a reload show them. */
export async function saveCounters(ctx: RunContext, counters: Counters) {
  await updateRun(ctx.runId, {
    metrics: metricsFrom(counters),
    cost_usd: Number(counters.costUsd.toFixed(6)),
  });
}

export async function note(ctx: RunContext, text: string) {
  await emit(ctx.runId, { type: "log", level: "warn", text });
}

export async function end(
  ctx: RunContext,
  counters: Counters,
  outcome: EndOutcome,
  startedAt: number,
) {
  return finishRun(ctx, counters, outcome, startedAt);
}
