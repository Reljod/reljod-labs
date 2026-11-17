import {
  checkSummary,
  decideApproval,
  nextMove,
  processChecksUnder,
  roundPassed,
} from "../domain/approval";
import { layoutDeck } from "../domain/deck-layout";
import { documentSections } from "../domain/document";
import { clock } from "../domain/process";
import { blocking, type CheckResult, ruleSet } from "../domain/rules";
import type {
  DeckRound,
  RunEventInput,
  StageId,
  StageState,
} from "../domain/run";
import { STAGES } from "../domain/run";
import { auditPipeline } from "./audit";
import { closeStream, log, publish } from "./emit";
import { RunError, stageFailure } from "./errors";
import type { RunContext } from "./llm";
import {
  claimRun,
  pipelineRun,
  pipelineStatus,
  type RunRow,
} from "./repository";
import { checkRound, designPlan } from "./stages/deck";
import { extractProcess, verifyProcess } from "./stages/process";
import { watchRecording } from "./stages/watch";

/*
 * One Run as a durable workflow. Every stage is a step that reads what it
 * needs from the Run's row and writes what it made back (through `publish`,
 * which also streams it), so the workflow itself only carries ids and the
 * loop's next move. A stopped Run ends quietly between stages.
 *
 * Each pass of the pipeline has a generation: 0 for the Run, n for its nth
 * Redo. The row only takes writes from the current generation, so a step of
 * an older pass that is still in flight cannot overwrite a Redo.
 */

export type PipelineInput = {
  runId: string;
  owner: string;
  /** `full` runs every stage; `redo` runs Design, Check and Approve again. */
  mode: "full" | "redo";
  /** The site that started the Run: where a Sample is fetched from. */
  origin: string;
  /** The Run's `redos` when this pass started. */
  generation: number;
};

const LABEL = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage.label]),
) as Record<StageId, string>;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function contextOf(input: PipelineInput): RunContext {
  return {
    runId: input.runId,
    owner: input.owner,
    generation: input.generation,
  };
}

async function loadRow(runId: string): Promise<RunRow> {
  const row = await pipelineRun(runId);
  if (!row) throw new RunError("The Run is gone.");
  return row;
}

/**
 * Changes one stage on the row, together with whatever else the stage made,
 * in one write, and streams it. False when it did not apply: the Run was
 * stopped, failed as stale or redone meanwhile.
 */
async function markStage(
  ctx: RunContext,
  row: RunRow,
  id: StageId,
  change: Partial<StageState>,
  extra: RunEventInput[] = [],
  rowOnly: { grounding?: CheckResult | null } = {},
): Promise<boolean> {
  const stages = row.stages.map((stage) =>
    stage.id === id ? { ...stage, ...change } : stage,
  );
  row.stages = stages;
  return publish(
    ctx,
    [{ type: "patch", patch: { stages } }, ...extra],
    rowOnly,
  );
}

/**
 * Marks a stage done with what it made, in one write. When the Run stopped
 * (or failed as stale, or a Redo replaced this pass) while it worked, the
 * write does not apply, what it made is dropped, nothing is audited and
 * this returns false. Design and Check add each Round's time to the stage's.
 */
async function stageDone(
  ctx: RunContext,
  row: RunRow,
  id: StageId,
  summary: string,
  started: number,
  extra: RunEventInput[] = [],
  carryMs = 0,
  rowOnly: { grounding?: CheckResult | null } = {},
): Promise<boolean> {
  const ms = carryMs + Date.now() - started;
  const applied = await markStage(
    ctx,
    row,
    id,
    { status: "done", summary, ms },
    [...extra, log(`✓ ${LABEL[id]} (${(ms / 1000).toFixed(1)}s): ${summary}`)],
    rowOnly,
  );
  if (!applied) return false;
  await auditPipeline({
    owner: ctx.owner,
    action: "stage.completed",
    runId: ctx.runId,
    summary: `${LABEL[id]}: ${summary}`,
    detail: { stage: id, ms, generation: ctx.generation },
  });
  return true;
}

/** The time a repeated stage already spent in earlier Rounds of this pass. */
function earlierMs(row: RunRow, id: StageId, round: number) {
  if (round <= 1) return 0;
  return row.stages.find((stage) => stage.id === id)?.ms ?? 0;
}

// Steps ----------------------------------------------------------------------------

async function beginStep(input: PipelineInput) {
  "use step";
  const ctx = contextOf(input);
  if (!(await claimRun(input.runId, input.generation))) return false;
  const row = await loadRow(input.runId);
  await publish(ctx, [
    { type: "patch", patch: { status: "running" } },
    log(
      input.mode === "redo"
        ? `Redo ${row.redos}: Design, Check and Approve under Rules v${row.rules_version}`
        : `Run ${row.id.slice(0, 8)} · Watch ${row.models.watch} · Write ${row.models.write} · Review ${row.models.review}`,
    ),
  ]);
  return true;
}

/** Whether this pass should go on: not stopped, failed, replaced or gone. */
async function goingStep(runId: string, generation: number) {
  "use step";
  return (await pipelineStatus(runId, generation)) === "running";
}

function processSummary(checks: CheckResult[]) {
  const failed = checks.filter((check) => !check.passed);
  const stillBlocking = blocking(checks);
  return failed.length === 0
    ? `${plural(checks.length, "Check")} passed`
    : `${checks.length - failed.length} of ${checks.length} Checks passed${stillBlocking.length > 0 ? `, ${stillBlocking.length} blocking` : ""}`;
}

/**
 * The start of a Redo: the Process Checks run again under the Rules the Redo
 * took, so a Rule raised to block holds the Deck and one lowered no longer does.
 */
async function recheckStep(input: PipelineInput) {
  "use step";
  const ctx = contextOf(input);
  const row = await loadRow(input.runId);
  if (!row.process) throw new RunError("There is no Process.");
  const checks = processChecksUnder({
    process: row.process,
    watch: row.watch,
    grounding: row.grounding,
    rules: ruleSet(row.rules),
  });
  const stages = row.stages.map((stage) =>
    stage.id === "verify"
      ? {
          ...stage,
          summary: `${processSummary(checks)} under Rules v${row.rules_version}`,
        }
      : stage,
  );
  await publish(ctx, [
    { type: "patch", patch: { processChecks: checks, stages } },
    log(
      `Process Checks again under Rules v${row.rules_version}: ${processSummary(checks)}`,
      blocking(checks).length > 0 ? "warn" : "info",
    ),
  ]);
}

async function watchStep(input: PipelineInput) {
  "use step";
  const ctx = contextOf(input);
  const row = await loadRow(input.runId);
  const started = Date.now();
  await markStage(ctx, row, "watch", { status: "running" }, [
    log(`▶ Watch: sending the Recording to ${row.models.watch}`),
  ]);
  const watch = await watchRecording(ctx, row, input.origin);
  const speakers = watch.participants.map((person) => person.name).join(", ");
  await stageDone(
    ctx,
    row,
    "watch",
    `${plural(watch.observations.length, "moment")}, ${clock(watch.durationSeconds)} long`,
    started,
    [
      { type: "patch", patch: { watch, title: watch.title } },
      log(`  heard ${speakers || "nobody by name"}`),
    ],
  );
}
watchStep.maxRetries = 1;

async function extractStep(input: PipelineInput) {
  "use step";
  const ctx = contextOf(input);
  const row = await loadRow(input.runId);
  if (!row.watch) {
    throw new RunError("There is nothing watched to extract from.");
  }
  const started = Date.now();
  await markStage(ctx, row, "extract", { status: "running" }, [
    log(`▶ Extract: ${row.models.write} writes the Process`),
  ]);
  const process = await extractProcess(ctx, {
    watch: row.watch,
    rules: ruleSet(row.rules),
    models: row.models,
  });
  const decisions = process.steps.filter((step) => step.decision).length;
  await stageDone(
    ctx,
    row,
    "extract",
    `${plural(process.steps.length, "step")}, ${plural(decisions, "decision")}, ${plural(process.openQuestions.length, "open question")}`,
    started,
    [{ type: "patch", patch: { process, title: process.title || row.title } }],
  );
}
extractStep.maxRetries = 1;

async function verifyStep(input: PipelineInput) {
  "use step";
  const ctx = contextOf(input);
  const row = await loadRow(input.runId);
  if (!row.watch || !row.process) throw new RunError("There is no Process.");
  const started = Date.now();
  await markStage(ctx, row, "verify", { status: "running" }, [
    log("▶ Verify: Process Rules, then the reviewer checks every step"),
  ]);
  const verified = await verifyProcess(
    ctx,
    {
      process: row.process,
      watch: row.watch,
      rules: ruleSet(row.rules),
      models: row.models,
    },
    async (text) => {
      await publish(ctx, [log(`  ${text}`, "warn")]);
    },
  );
  await stageDone(
    ctx,
    row,
    "verify",
    `${processSummary(verified.checks)}${verified.repaired ? " after one repair" : ""}`,
    started,
    [
      {
        type: "patch",
        patch: {
          process: verified.process,
          processChecks: verified.checks,
          processFindings: verified.findings,
        },
      },
      ...blocking(verified.checks).map((check) =>
        log(`  still failing: ${check.summary}`, "warn"),
      ),
    ],
    0,
    {
      grounding:
        verified.checks.find((check) => check.ruleId === "process.grounded") ??
        null,
    },
  );
}
verifyStep.maxRetries = 1;

async function documentStep(input: PipelineInput) {
  "use step";
  const ctx = contextOf(input);
  const row = await loadRow(input.runId);
  if (!row.process) throw new RunError("There is no Process.");
  const started = Date.now();
  await markStage(ctx, row, "document", { status: "running" });
  const sections = documentSections(row.process, {
    recordingName: row.recording_name ?? row.title,
    generatedAt: new Date().toISOString(),
    status: "draft",
  });
  await stageDone(
    ctx,
    row,
    "document",
    `${plural(sections.length, "section")}, ${plural(row.process.steps.length, "step")}`,
    started,
  );
}

/** Design for one Round: plans the Deck and shows it before it is checked. */
async function designStep(
  input: PipelineInput,
  round: number,
  by: DeckRound["by"],
) {
  "use step";
  const ctx = contextOf(input);
  const row = await loadRow(input.runId);
  if (!row.process) {
    throw new RunError("There is no Process to plan slides from.");
  }
  const rules = ruleSet(row.rules);
  const earlier = row.rounds.filter((item) => item.round < round);
  const previous = earlier.at(-1) ?? null;
  const carry = earlierMs(row, "design", round);
  const started = Date.now();
  await markStage(ctx, row, "design", { status: "running", summary: null }, [
    log(
      by === "auto-fit"
        ? `▶ Design, round ${round}: fitting the last plan by rule`
        : by === "revision"
          ? `▶ Design, round ${round}: ${row.models.write} revises the slides`
          : `▶ Design, round ${round}: ${row.models.write} plans the slides`,
    ),
  ]);
  const designed = await designPlan(ctx, {
    round,
    by,
    process: row.process,
    previous,
    rules,
    models: row.models,
  });
  const deck = layoutDeck(designed.plan, row.process, rules);
  const current: DeckRound = {
    round,
    by,
    plan: designed.plan,
    deck,
    checks: [],
    findings: [],
    passed: false,
  };
  const rounds = [...earlier, current];
  row.rounds = rounds;
  const done = await stageDone(
    ctx,
    row,
    "design",
    `Round ${round}: ${plural(deck.slides.length, "slide")}${by === "auto-fit" ? " (fit by rule)" : designed.fallback ? " (planned by rule)" : ""}`,
    started,
    [
      { type: "patch", patch: { rounds } },
      ...(designed.fallback
        ? [
            log(
              `  ${designed.fallback}; planned the deck by rule instead`,
              "warn",
            ),
          ]
        : []),
    ],
    carry,
  );
  // Only for a revision this pass really wrote: a stopped or replaced pass,
  // or a retried step whose first try failed, adds nothing to the trail.
  if (done && by === "revision") {
    await auditPipeline({
      owner: ctx.owner,
      action: "deck.revised",
      runId: ctx.runId,
      summary: `Round ${round - 1} sent back: ${checkSummary(round - 1, previous?.checks ?? [], previous?.findings ?? []).replace(/^Round \d+: /, "")}`,
      detail: { round, generation: ctx.generation },
    });
  }
}
designStep.maxRetries = 1;

/** Check for one Round. Returns what the loop does next. */
async function checkStep(input: PipelineInput, round: number) {
  "use step";
  const ctx = contextOf(input);
  const row = await loadRow(input.runId);
  const current = row.rounds.find((item) => item.round === round);
  if (!row.process || !current) {
    throw new RunError("There is no Deck to check.");
  }
  const rules = ruleSet(row.rules);
  const carry = earlierMs(row, "check", round);
  const started = Date.now();
  await markStage(ctx, row, "check", { status: "running", summary: null }, [
    log(`▶ Check, round ${round}: measuring every slide`),
  ]);
  const { checks, findings } = await checkRound(ctx, {
    round,
    plan: current.plan,
    process: row.process,
    rules,
    models: row.models,
  });
  const passed = roundPassed(checks, findings, rules);
  const rounds = row.rounds.map((item) =>
    item.round === round ? { ...item, checks, findings, passed } : item,
  );
  row.rounds = rounds;
  const move = nextMove({ round, passed, checks, rules });
  const failures = blocking(checks).slice(0, 3);
  await stageDone(
    ctx,
    row,
    "check",
    checkSummary(round, checks, findings),
    started,
    [
      { type: "patch", patch: { rounds } },
      ...failures.map((check) => log(`  ${check.summary}`, "warn")),
      ...(move === "revise"
        ? [log(`  round ${round} failed; sending the slides back to Design`)]
        : move === "auto-fit"
          ? [log(`  round ${round} failed; the last round fits by rule`)]
          : []),
    ],
    carry,
  );
  return move;
}
checkStep.maxRetries = 1;

async function approveStep(input: PipelineInput) {
  "use step";
  const ctx = contextOf(input);
  const row = await loadRow(input.runId);
  if (!row.process) throw new RunError("There is no Process.");
  const rules = ruleSet(row.rules);
  const started = Date.now();
  const at = new Date().toISOString();
  // Decided on the Process Checks under this pass's Rules, never on ones
  // stored under other Rules.
  const processChecks = processChecksUnder({
    process: row.process,
    watch: row.watch,
    grounding: row.grounding,
    rules,
  });
  const approval = decideApproval({
    round: row.rounds.at(-1) ?? null,
    processChecks,
    rules,
    at,
  });
  const done = await stageDone(
    ctx,
    row,
    "approve",
    approval.status === "approved"
      ? `Approved in round ${approval.round}`
      : "Held for a person",
    started,
    [
      {
        type: "patch",
        patch: {
          processChecks,
          approval,
          status: "completed",
          completedAt: at,
        },
      },
      log(
        `${approval.status === "approved" ? "Approved" : "Held"}: ${approval.reason}`,
        approval.status === "approved" ? "info" : "warn",
      ),
      { type: "end", status: "completed" },
    ],
  );
  // Stopped during the last Check: no verdict is written or audited.
  if (!done) {
    await closeStream().catch(() => {});
    return;
  }
  await auditPipeline({
    owner: ctx.owner,
    action: approval.status === "approved" ? "deck.approved" : "deck.held",
    runId: ctx.runId,
    summary: approval.reason,
    detail: { round: approval.round, generation: ctx.generation },
  });
  const final = await loadRow(input.runId);
  await auditPipeline({
    owner: ctx.owner,
    action: "run.completed",
    runId: ctx.runId,
    summary: `${final.title || "Run"} finished: ${approval.status}, $${Number(final.cost_usd).toFixed(4)}`,
    detail: { approval: approval.status, costUsd: Number(final.cost_usd) },
  });
  await closeStream();
}

async function failStep(input: PipelineInput, stage: StageId, raw: string) {
  "use step";
  const ctx = contextOf(input);
  const error = stageFailure(stage, raw);
  const row = await pipelineRun(input.runId);
  const applied =
    row !== null &&
    (await markStage(ctx, row, stage, { status: "failed", summary: error }, [
      {
        type: "patch",
        patch: {
          status: "failed",
          error,
          completedAt: new Date().toISOString(),
        },
      },
      log(`✗ ${LABEL[stage]} failed: ${error}`, "error"),
      { type: "end", status: "failed" },
    ]));
  if (applied) {
    await auditPipeline({
      owner: input.owner,
      action: "run.failed",
      runId: input.runId,
      summary: `${LABEL[stage]} failed: ${error}`,
      detail: { stage, generation: input.generation },
    });
  }
  await closeStream().catch(() => {});
}

/** A Run someone stopped: the stream ends with it. */
async function stoppedStep() {
  "use step";
  await closeStream().catch(() => {});
}

// Orchestration --------------------------------------------------------------------

/** One Run: Watch → Extract → Verify → Document → (Design → Check)×Rounds → Approve. */
export async function processTransferRun(input: PipelineInput) {
  "use workflow";
  let stage: StageId = input.mode === "redo" ? "design" : "watch";
  const ended = { runId: input.runId, ended: false };
  try {
    if (!(await beginStep(input))) return ended;
    if (input.mode === "full") {
      for (const [id, run] of [
        ["watch", watchStep],
        ["extract", extractStep],
        ["verify", verifyStep],
        ["document", documentStep],
      ] as const) {
        if (!(await goingStep(input.runId, input.generation))) {
          await stoppedStep();
          return ended;
        }
        stage = id;
        await run(input);
      }
    } else {
      await recheckStep(input);
      // No model: a Redo of a Run stopped before it gets its document too.
      stage = "document";
      await documentStep(input);
    }
    let by: DeckRound["by"] = "draft";
    for (let round = 1; ; round++) {
      if (!(await goingStep(input.runId, input.generation))) {
        await stoppedStep();
        return ended;
      }
      stage = "design";
      await designStep(input, round, by);
      stage = "check";
      const move = await checkStep(input, round);
      if (move === "approve" || move === "hold") break;
      by = move === "auto-fit" ? "auto-fit" : "revision";
    }
    stage = "approve";
    await approveStep(input);
    return { runId: input.runId, ended: true };
  } catch (error) {
    await failStep(
      input,
      stage,
      error instanceof Error ? error.message : String(error),
    );
    return ended;
  }
}
