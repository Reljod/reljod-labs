import type { ModelMessage, ToolResultPart } from "ai";
import {
  analystTurn,
  begin,
  type EndOutcome,
  end,
  type Ledger,
  mergeReaders,
  planReaders,
  readOneRange,
  runTool,
  type ToolCall,
  type ToolOutcome,
} from "./analyst";
import { emit, runSink } from "./emit";
import type { ReaderJob, ReaderResult } from "./reader";
import {
  type AnalystState,
  RUN_LIMITS,
  type RunContext,
} from "./toolkit/state";

export type RunInput = { ctx: RunContext };

// Steps: each is durable, so a crash resumes after the last finished one. -----------------

async function beginStep(ctx: RunContext): Promise<AnalystState> {
  "use step";
  return begin(ctx);
}

async function turnStep(ctx: RunContext, messages: ModelMessage[]) {
  "use step";
  return analystTurn(ctx, messages);
}
// The gateway is sometimes flaky for a provider; a failed turn is retried.
turnStep.maxRetries = 2;

async function toolStep(ctx: RunContext, ledger: Ledger, call: ToolCall) {
  "use step";
  return runTool(ctx, ledger, call);
}
toolStep.maxRetries = 1;

async function planReadersStep(
  ctx: RunContext,
  ledger: Ledger,
  call: ToolCall,
) {
  "use step";
  return planReaders(ctx, ledger, call);
}

async function readerStep(
  ctx: RunContext,
  job: ReaderJob,
): Promise<ReaderResult> {
  "use step";
  return readOneRange(ctx, job);
}
// runReader reports its own failures; a retry would only bill the range twice.
readerStep.maxRetries = 0;

async function mergeReadersStep(
  ctx: RunContext,
  ledger: Ledger,
  call: ToolCall,
  plan: { jobs: ReaderJob[]; notes: string[] },
  results: ReaderResult[],
  started: number,
) {
  "use step";
  return mergeReaders(ctx, ledger, call, plan, results, started);
}

async function spendStep(ctx: RunContext, costUsd: number) {
  "use step";
  await runSink().update(ctx.runId, { cost_usd: Number(costUsd.toFixed(6)) });
}

async function nudgeStep(ctx: RunContext, text: string) {
  "use step";
  await emit(ctx.runId, { type: "log", level: "warn", text });
}

async function endStep(ctx: RunContext, ledger: Ledger, outcome: EndOutcome) {
  "use step";
  return end(ctx, ledger, outcome);
}

// Orchestration -------------------------------------------------------------------------

const SPEND_CAP_NOTE = `Stopped at the spend cap of $${RUN_LIMITS.costUsd.toFixed(2)} before the Done gate passed; the Register is what was found so far.`;

function ledgerOf(state: AnalystState): Ledger {
  const { messages: _messages, ...ledger } = state;
  return ledger;
}

/** Readers are fanned out as parallel steps; the first goes alone to warm the prompt cache. */
async function spawnReaders(
  ctx: RunContext,
  ledger: Ledger,
  call: ToolCall,
): Promise<ToolOutcome> {
  const started = Date.now();
  const plan = await planReadersStep(ctx, ledger, call);
  if (plan.kind === "refused") return { ledger, output: plan.output };
  const [first, ...rest] = plan.jobs;
  const warm = plan.jobs.length > 4 ? [await readerStep(ctx, first)] : [];
  const results = [
    ...warm,
    ...(await Promise.all(
      (warm.length ? rest : plan.jobs).map((job) => readerStep(ctx, job)),
    )),
  ];
  return mergeReadersStep(ctx, ledger, call, plan, results, started);
}

/**
 * One Run of the Analyst over one Document. Each Analyst turn is a step that
 * calls the model once with tools that do not execute; each tool call it
 * returns is a step of its own (spawn_readers fans out into parallel Reader
 * steps). The loop ends when `finish` passes the Done gate, at the turn or
 * spend cap (checked before every turn and every tool call), or when the Run
 * row is over (stopped by its Owner, or failed elsewhere).
 */
export async function nameExtractionRun(input: RunInput) {
  "use workflow";
  const { ctx } = input;
  let ledger: Ledger = {
    register: [],
    dismissed: {},
    pagesRead: [],
    readers: [],
    skills: [],
    turns: 0,
    codeRuns: 0,
    costUsd: 0,
  };
  try {
    const state = await beginStep(ctx);
    let messages = state.messages;
    ledger = ledgerOf(state);
    let outcome: EndOutcome | null = null;
    let idle = 0;

    while (!outcome) {
      if (ledger.turns >= RUN_LIMITS.analystTurns) {
        outcome = {
          status: "completed",
          stoppedBy: "turns",
          note: `Stopped at the cap of ${RUN_LIMITS.analystTurns} Analyst turns before the Done gate passed; the Register is what was found so far.`,
        };
        break;
      }
      if (ledger.costUsd >= RUN_LIMITS.costUsd) {
        outcome = {
          status: "completed",
          stoppedBy: "cost",
          note: SPEND_CAP_NOTE,
        };
        break;
      }

      const turn = await turnStep(ctx, messages);
      if (turn.kind === "over") {
        // The row is already over, so end() writes nothing; it still stops the Sandbox.
        const ended = await endStep(ctx, ledger, {
          status: "failed",
          error: "The Run ended outside the workflow.",
        });
        return { runId: ctx.runId, status: ended.status, score: null };
      }
      messages = turn.messages;
      ledger = {
        ...ledger,
        turns: ledger.turns + 1,
        costUsd: ledger.costUsd + turn.costUsd,
      };

      if (turn.toolCalls.length === 0) {
        idle++;
        if (idle >= 3) {
          outcome = {
            status: "completed",
            stoppedBy: "idle",
            note: "The Analyst stopped calling tools before the Done gate passed.",
          };
          break;
        }
        await nudgeStep(
          ctx,
          "The Analyst answered without a tool call; reminded it to work through the tools.",
        );
        messages = [
          ...messages,
          {
            role: "user",
            content:
              "Keep working through the tools. When the Done gate passes, call finish with a summary.",
          },
        ];
        continue;
      }
      idle = 0;

      const results: ToolResultPart[] = [];
      for (const call of turn.toolCalls) {
        // The turn's own cost, or the Readers of an earlier call in it, may have reached the cap.
        if (!outcome && ledger.costUsd >= RUN_LIMITS.costUsd)
          outcome = {
            status: "completed",
            stoppedBy: "cost",
            note: SPEND_CAP_NOTE,
          };
        if (outcome) {
          results.push({
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: "text", value: "Not run: the Run finished." },
          });
          continue;
        }
        const done: ToolOutcome =
          call.toolName === "spawn_readers"
            ? await spawnReaders(ctx, ledger, call)
            : await toolStep(ctx, ledger, call);
        ledger = done.ledger;
        results.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: { type: "text", value: done.output },
        });
        if ("finished" in done && done.finished) {
          outcome = { status: "completed", summary: done.finished.summary };
        }
      }
      messages = [...messages, { role: "tool", content: results }];
      await spendStep(ctx, ledger.costUsd);
    }

    const ended = await endStep(ctx, ledger, outcome);
    return {
      runId: ctx.runId,
      status: ended.status,
      score: ended.score ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const ended = await endStep(ctx, ledger, {
      status: "failed",
      error: message,
    });
    return { runId: ctx.runId, status: ended.status, score: null };
  }
}
