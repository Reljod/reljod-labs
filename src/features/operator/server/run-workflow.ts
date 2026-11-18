import { createHook, sleep } from "workflow";
import { LIMITS } from "../domain/limits";
import type { Change } from "../legacy/types";
import { type Counters, emptyCounters, type RunContext } from "./context";
import type { EndOutcome } from "./finish";
import type { ToolCall, TranscriptItem } from "./operator";
import {
  begin,
  type CallResult,
  end,
  note,
  pause,
  resumeCall,
  runCall,
  saveCounters,
  settle,
  turn,
} from "./run-steps";

export type RunInput = { ctx: RunContext };

// Steps: each is durable, so a crash resumes after the last finished one. The
// names are replay keys (conventions.md): do not rename or move them while a
// Run may be waiting on an Approval.

async function beginStep(ctx: RunContext) {
  "use step";
  return begin(ctx);
}
beginStep.maxRetries = 1;

async function turnStep(
  ctx: RunContext,
  transcript: TranscriptItem[],
  number: number,
) {
  "use step";
  return turn(ctx, transcript, number);
}
// The gateway is sometimes flaky for a provider; a failed Turn is retried.
turnStep.maxRetries = 2;

async function actionStep(
  ctx: RunContext,
  counters: Counters,
  at: { turn: number; intent: string },
  call: ToolCall,
  keyed: Change[],
) {
  "use step";
  return runCall(ctx, counters, at, call, keyed);
}
// A key pressed twice is a second key: an Action is never retried.
actionStep.maxRetries = 0;

async function resumeActionStep(
  ctx: RunContext,
  counters: Counters,
  at: { turn: number; intent: string },
  call: ToolCall,
  skip: number,
) {
  "use step";
  return resumeCall(ctx, counters, at, call, skip);
}
resumeActionStep.maxRetries = 0;

async function pauseStep(
  ctx: RunContext,
  counters: Counters,
  outcome: NonNullable<CallResult["outcome"]>,
  token: string,
) {
  "use step";
  return pause(ctx, counters, outcome, token);
}

async function settleStep(
  ctx: RunContext,
  approvalId: string,
  fingerprint: string,
  answer: "approved" | "refused" | null,
) {
  "use step";
  return settle(ctx, approvalId, fingerprint, answer);
}

async function saveStep(ctx: RunContext, counters: Counters) {
  "use step";
  await saveCounters(ctx, counters);
}

async function noteStep(ctx: RunContext, text: string) {
  "use step";
  await note(ctx, text);
}

async function endStep(
  ctx: RunContext,
  counters: Counters,
  outcome: EndOutcome,
  startedAt: number,
) {
  "use step";
  return end(ctx, counters, outcome, startedAt);
}

export type ApprovalAnswer = { decision: "approved" | "refused" };

const NOT_RUN = "Not run: an earlier call in this turn was stopped. Look at the Screen and decide again.";

/**
 * One Run of the Operator on one Task. Each Turn is a step that calls the
 * model once with tools that do not execute; each call it returns is a step
 * of its own, and every screen call goes through the Guard. When the Guard
 * pauses a guarded Action, the workflow, not the model, waits on a hook for
 * a person (or for the wait to run out), and only then presses the key. The
 * loop ends when the Operator calls `finish_run`, at a cap (Turns, Actions,
 * spend, time), or when the Run row is over; code then checks the Books.
 */
export async function operatorRun(input: RunInput) {
  "use workflow";
  const { ctx } = input;
  let counters = emptyCounters();
  let startedAt = Date.now();
  try {
    const begun = await beginStep(ctx);
    counters = begun.counters;
    startedAt = begun.startedAt;
    const transcript: TranscriptItem[] = [];
    let keyed: Change[] = [];
    let outcome: EndOutcome | null = null;
    let idle = 0;

    while (!outcome) {
      if (counters.turns >= LIMITS.turnsPerRun)
        outcome = { status: "completed", stoppedBy: "turns" };
      else if (counters.actions >= LIMITS.actionsPerRun)
        outcome = { status: "completed", stoppedBy: "actions" };
      else if (counters.costUsd >= LIMITS.usdPerRun)
        outcome = { status: "completed", stoppedBy: "cost" };
      else if (Date.now() - startedAt > (LIMITS.sandboxMinutes - 2) * 60_000)
        outcome = { status: "completed", stoppedBy: "time" };
      if (outcome) break;

      const number = counters.turns;
      const result = await turnStep(ctx, transcript, number);
      if (result.kind === "over") {
        // The row is already over (stopped), so end() writes nothing; it still removes the sandboxes.
        await endStep(
          ctx,
          counters,
          { status: "failed", error: "The Run ended outside the workflow." },
          startedAt,
        );
        return { runId: ctx.runId };
      }
      counters = {
        ...counters,
        turns: number + 1,
        costUsd: counters.costUsd + (result.usage?.costUsd ?? 0),
        inputTokens: counters.inputTokens + (result.usage?.inputTokens ?? 0),
        outputTokens: counters.outputTokens + (result.usage?.outputTokens ?? 0),
        cachedInputTokens:
          counters.cachedInputTokens + (result.usage?.cachedInputTokens ?? 0),
      };
      const calls = result.calls;
      transcript.push({ role: "assistant", text: result.text, calls });

      if (calls.length === 0) {
        idle += 1;
        if (idle >= 3) {
          outcome = { status: "completed", stoppedBy: "idle" };
          break;
        }
        await noteStep(
          ctx,
          "The Operator answered without acting; reminded it to use its tools.",
        );
        transcript.push({
          role: "note",
          text: "Act through the tools. When the Task is done, sign off and call finish_run.",
        });
        continue;
      }
      idle = 0;

      const at = { turn: number + 1, intent: result.text.split("\n")[0] ?? "" };
      const results: { toolCallId: string; toolName: string; output: string }[] =
        [];
      let frame: number | null = null;
      let hint = "";
      let halted = false;
      let over = false;
      for (const [index, call] of calls.entries()) {
        const answer = (output: string) =>
          results.push({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
          });
        if (halted || outcome || over) {
          answer(outcome ? "Not run: the Run finished." : NOT_RUN);
          continue;
        }
        if (index >= LIMITS.actionsPerTurn) {
          answer(`Not run: at most ${LIMITS.actionsPerTurn} calls a turn.`);
          continue;
        }
        let done = await actionStep(ctx, counters, at, call, keyed);
        counters = done.counters;
        let output = done.output;
        const stopped = done.outcome?.blocked;
        if (done.outcome && stopped?.decision.kind === "pause") {
          // The harness pauses here; the model is not asked and cannot answer.
          const token = `operator:${ctx.runId}:${counters.pauses}`;
          const hook = createHook<ApprovalAnswer>({ token });
          // Register the hook before anyone can see the Approval and decide it.
          await hook.getConflict();
          const opened = await pauseStep(ctx, counters, done.outcome, token);
          if (!opened) {
            over = true;
            answer(NOT_RUN);
            continue;
          }
          counters = opened.counters;
          const decided = await Promise.race([
            hook.then((payload) => payload.decision),
            sleep(`${LIMITS.approvalWaitMinutes}m`).then(() => null),
          ]);
          const settled = await settleStep(
            ctx,
            opened.approvalId,
            opened.fingerprint,
            decided,
          );
          if (!settled.active) {
            over = true;
            answer(NOT_RUN);
            continue;
          }
          if (settled.decision === "approved") {
            done = await resumeActionStep(
              ctx,
              counters,
              at,
              call,
              stopped.applied,
            );
            counters = done.counters;
            output = done.outcome
              ? done.output
              : "The Run paused for a person, who APPROVED. The harness pressed the key. The Screen now is in the picture.";
            if (done.outcome) halted = true;
          } else {
            output =
              settled.decision === "refused"
                ? "The Run paused for a person, who REFUSED this change. The key was not pressed. Leave that change undone, do not try it again, and carry on with the rest of the Task."
                : "The Run paused for a person and nobody decided in time, so the harness refused the change. The key was not pressed. Leave it undone and carry on with the rest of the Task.";
            halted = true;
          }
        } else if (stopped) {
          halted = true;
        }
        if (done.frame !== null) {
          frame = done.frame;
          hint = done.hint ?? "";
        }
        if (done.diff) keyed = done.diff;
        answer(output);
        if (done.finished !== undefined)
          outcome = {
            status: "completed",
            stoppedBy: "finish",
            summary: done.finished,
          };
      }
      transcript.push({ role: "results", results, frame, hint });
      if (over) {
        await endStep(
          ctx,
          counters,
          { status: "failed", error: "The Run ended while it was paused." },
          startedAt,
        );
        return { runId: ctx.runId };
      }
      await saveStep(ctx, counters);
    }

    await endStep(ctx, counters, outcome, startedAt);
    return { runId: ctx.runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await endStep(
      ctx,
      counters,
      { status: "failed", error: message.slice(0, 500) },
      startedAt,
    );
    return { runId: ctx.runId };
  }
}
