import {
  checkSummary,
  decideApproval,
  type NextMove,
  nextMove,
  processChecksUnder,
  roundPassed,
} from "../../domain/approval";
import { layoutDeck } from "../../domain/deck-layout";
import { documentSections } from "../../domain/document";
import { clock } from "../../domain/process";
import { blocking, type CheckResult, ruleSet } from "../../domain/rules";
import type {
  DeckRound,
  RunEventInput,
  RunLog,
  StageId,
  StageState,
} from "../../domain/run";
import { STAGES } from "../../domain/run";
import { RunError, stageFailure } from "../errors";
import type { RunContext } from "../llm";
import type { Analyst, AuditLog, PipelineRuns, RunFeed } from "../ports";
import type { RunRow } from "../run-row";
import type { PipelineInput } from "../run-workflow";

/*
 * What each step of a Run's workflow does (`run-workflow.ts` keeps only the
 * step and workflow functions, whose names are replay keys). Every Stage
 * reads what it needs from the Run's row and writes what it made back
 * through the feed, which also streams it, so the workflow itself only
 * carries ids and the loop's next move.
 *
 * Each pass of the pipeline has a generation: 0 for the Run, n for its nth
 * Redo. The row only takes writes from the current generation, so a step of
 * an older pass that is still in flight cannot overwrite a Redo.
 */

export interface PipelineService {
  /** Claims the Run for this pass; false when it was stopped or redone meanwhile. */
  begin(input: PipelineInput): Promise<boolean>;
  /** Whether this pass should go on: not stopped, failed, replaced or gone. */
  going(runId: string, generation: number): Promise<boolean>;
  /** A Redo's start: the Process Checks again under the Rules it took. */
  recheck(input: PipelineInput): Promise<void>;
  watch(input: PipelineInput): Promise<void>;
  extract(input: PipelineInput): Promise<void>;
  verify(input: PipelineInput): Promise<void>;
  document(input: PipelineInput): Promise<void>;
  design(
    input: PipelineInput,
    round: number,
    by: DeckRound["by"],
  ): Promise<void>;
  /** Returns what the loop does next. */
  check(input: PipelineInput, round: number): Promise<NextMove>;
  approve(input: PipelineInput): Promise<void>;
  fail(input: PipelineInput, stage: StageId, raw: string): Promise<void>;
  /** A Run someone stopped: the stream ends with it. */
  stopped(): Promise<void>;
}

export type PipelinePorts = {
  runs: PipelineRuns;
  feed: RunFeed;
  audit: Pick<AuditLog, "pipeline">;
  analyst: Analyst;
  now: () => number;
};

const LABEL = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage.label]),
) as Record<StageId, string>;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function log(
  text: string,
  level: RunLog["level"] = "info",
): RunEventInput {
  return { type: "log", level, text };
}

function contextOf(input: PipelineInput): RunContext {
  return {
    runId: input.runId,
    owner: input.owner,
    generation: input.generation,
  };
}

function processSummary(checks: CheckResult[]) {
  const failed = checks.filter((check) => !check.passed);
  const stillBlocking = blocking(checks);
  return failed.length === 0
    ? `${plural(checks.length, "Check")} passed`
    : `${checks.length - failed.length} of ${checks.length} Checks passed${stillBlocking.length > 0 ? `, ${stillBlocking.length} blocking` : ""}`;
}

/** The time a repeated stage already spent in earlier Rounds of this pass. */
function earlierMs(row: RunRow, id: StageId, round: number) {
  if (round <= 1) return 0;
  return row.stages.find((stage) => stage.id === id)?.ms ?? 0;
}

export function createPipelineService(ports: PipelinePorts): PipelineService {
  const { runs, feed, audit, analyst, now } = ports;

  async function loadRow(runId: string): Promise<RunRow> {
    const row = await runs.run(runId);
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
    return feed.publish(
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
    const ms = carryMs + now() - started;
    const applied = await markStage(
      ctx,
      row,
      id,
      { status: "done", summary, ms },
      [
        ...extra,
        log(`✓ ${LABEL[id]} (${(ms / 1000).toFixed(1)}s): ${summary}`),
      ],
      rowOnly,
    );
    if (!applied) return false;
    await audit.pipeline({
      owner: ctx.owner,
      action: "stage.completed",
      runId: ctx.runId,
      summary: `${LABEL[id]}: ${summary}`,
      detail: { stage: id, ms, generation: ctx.generation },
    });
    return true;
  }

  return {
    async begin(input) {
      const ctx = contextOf(input);
      if (!(await runs.claim(input.runId, input.generation))) return false;
      const row = await loadRow(input.runId);
      await feed.publish(ctx, [
        { type: "patch", patch: { status: "running" } },
        log(
          input.mode === "redo"
            ? `Redo ${row.redos}: Design, Check and Approve under Rules v${row.rules_version}`
            : `Run ${row.id.slice(0, 8)} · Watch ${row.models.watch} · Write ${row.models.write} · Review ${row.models.review}`,
        ),
      ]);
      return true;
    },

    async going(runId, generation) {
      return (await runs.status(runId, generation)) === "running";
    },

    async recheck(input) {
      const ctx = contextOf(input);
      const row = await loadRow(input.runId);
      if (!row.process) throw new RunError("There is no Process.");
      // A Rule raised to block holds the Deck, and one lowered no longer does.
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
      await feed.publish(ctx, [
        { type: "patch", patch: { processChecks: checks, stages } },
        log(
          `Process Checks again under Rules v${row.rules_version}: ${processSummary(checks)}`,
          blocking(checks).length > 0 ? "warn" : "info",
        ),
      ]);
    },

    async watch(input) {
      const ctx = contextOf(input);
      const row = await loadRow(input.runId);
      const started = now();
      await markStage(ctx, row, "watch", { status: "running" }, [
        log(`▶ Watch: sending the Recording to ${row.models.watch}`),
      ]);
      const watch = await analyst.watch(ctx, row, input.origin);
      const speakers = watch.participants
        .map((person) => person.name)
        .join(", ");
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
    },

    async extract(input) {
      const ctx = contextOf(input);
      const row = await loadRow(input.runId);
      if (!row.watch) {
        throw new RunError("There is nothing watched to extract from.");
      }
      const started = now();
      await markStage(ctx, row, "extract", { status: "running" }, [
        log(`▶ Extract: ${row.models.write} writes the Process`),
      ]);
      const process = await analyst.extract(ctx, {
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
        [
          {
            type: "patch",
            patch: { process, title: process.title || row.title },
          },
        ],
      );
    },

    async verify(input) {
      const ctx = contextOf(input);
      const row = await loadRow(input.runId);
      if (!row.watch || !row.process) {
        throw new RunError("There is no Process.");
      }
      const started = now();
      await markStage(ctx, row, "verify", { status: "running" }, [
        log("▶ Verify: Process Rules, then the reviewer checks every step"),
      ]);
      const verified = await analyst.verify(
        ctx,
        {
          process: row.process,
          watch: row.watch,
          rules: ruleSet(row.rules),
          models: row.models,
        },
        async (text) => {
          await feed.publish(ctx, [log(`  ${text}`, "warn")]);
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
            verified.checks.find(
              (check) => check.ruleId === "process.grounded",
            ) ?? null,
        },
      );
    },

    async document(input) {
      const ctx = contextOf(input);
      const row = await loadRow(input.runId);
      if (!row.process) throw new RunError("There is no Process.");
      const started = now();
      await markStage(ctx, row, "document", { status: "running" });
      const sections = documentSections(row.process, {
        recordingName: row.recording_name ?? row.title,
        generatedAt: new Date(now()).toISOString(),
        status: "draft",
      });
      await stageDone(
        ctx,
        row,
        "document",
        `${plural(sections.length, "section")}, ${plural(row.process.steps.length, "step")}`,
        started,
      );
    },

    async design(input, round, by) {
      const ctx = contextOf(input);
      const row = await loadRow(input.runId);
      if (!row.process) {
        throw new RunError("There is no Process to plan slides from.");
      }
      const rules = ruleSet(row.rules);
      const earlier = row.rounds.filter((item) => item.round < round);
      const previous = earlier.at(-1) ?? null;
      const carry = earlierMs(row, "design", round);
      const started = now();
      await markStage(
        ctx,
        row,
        "design",
        { status: "running", summary: null },
        [
          log(
            by === "auto-fit"
              ? `▶ Design, round ${round}: fitting the last plan by rule`
              : by === "revision"
                ? `▶ Design, round ${round}: ${row.models.write} revises the slides`
                : `▶ Design, round ${round}: ${row.models.write} plans the slides`,
          ),
        ],
      );
      const designed = await analyst.design(ctx, {
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
        await audit.pipeline({
          owner: ctx.owner,
          action: "deck.revised",
          runId: ctx.runId,
          summary: `Round ${round - 1} sent back: ${checkSummary(round - 1, previous?.checks ?? [], previous?.findings ?? []).replace(/^Round \d+: /, "")}`,
          detail: { round, generation: ctx.generation },
        });
      }
    },

    async check(input, round) {
      const ctx = contextOf(input);
      const row = await loadRow(input.runId);
      const current = row.rounds.find((item) => item.round === round);
      if (!row.process || !current) {
        throw new RunError("There is no Deck to check.");
      }
      const rules = ruleSet(row.rules);
      const carry = earlierMs(row, "check", round);
      const started = now();
      await markStage(ctx, row, "check", { status: "running", summary: null }, [
        log(`▶ Check, round ${round}: measuring every slide`),
      ]);
      const { checks, findings } = await analyst.check(ctx, {
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
            ? [
                log(
                  `  round ${round} failed; sending the slides back to Design`,
                ),
              ]
            : move === "auto-fit"
              ? [log(`  round ${round} failed; the last round fits by rule`)]
              : []),
        ],
        carry,
      );
      return move;
    },

    async approve(input) {
      const ctx = contextOf(input);
      const row = await loadRow(input.runId);
      if (!row.process) throw new RunError("There is no Process.");
      const rules = ruleSet(row.rules);
      const started = now();
      const at = new Date(now()).toISOString();
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
        await feed.close().catch(() => {});
        return;
      }
      await audit.pipeline({
        owner: ctx.owner,
        action: approval.status === "approved" ? "deck.approved" : "deck.held",
        runId: ctx.runId,
        summary: approval.reason,
        detail: { round: approval.round, generation: ctx.generation },
      });
      const final = await loadRow(input.runId);
      await audit.pipeline({
        owner: ctx.owner,
        action: "run.completed",
        runId: ctx.runId,
        summary: `${final.title || "Run"} finished: ${approval.status}, $${Number(final.cost_usd).toFixed(4)}`,
        detail: { approval: approval.status, costUsd: Number(final.cost_usd) },
      });
      await feed.close();
    },

    async fail(input, stage, raw) {
      const ctx = contextOf(input);
      const error = stageFailure(stage, raw);
      const row = await runs.run(input.runId);
      const applied =
        row !== null &&
        (await markStage(
          ctx,
          row,
          stage,
          { status: "failed", summary: error },
          [
            {
              type: "patch",
              patch: {
                status: "failed",
                error,
                completedAt: new Date(now()).toISOString(),
              },
            },
            log(`✗ ${LABEL[stage]} failed: ${error}`, "error"),
            { type: "end", status: "failed" },
          ],
        ));
      if (applied) {
        await audit.pipeline({
          owner: input.owner,
          action: "run.failed",
          runId: input.runId,
          summary: `${LABEL[stage]} failed: ${error}`,
          detail: { stage, generation: input.generation },
        });
      }
      await feed.close().catch(() => {});
    },

    async stopped() {
      await feed.close().catch(() => {});
    },
  };
}
