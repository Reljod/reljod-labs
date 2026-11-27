import "server-only";
import { applyRuleJob } from "../../domain/execute";
import type { JobId } from "../../domain/jobs";
import type { PipelineId } from "../../domain/pipelines";
import { screeningCheck } from "../../domain/rules/screening";
import type { Answer } from "../../domain/run-events";
import {
  type RunDocument,
  type RunState,
  withChecks,
} from "../../domain/run-state";
import { WATCHLIST } from "../../domain/watchlist";
import type { RunContext } from "../jobs/context";
import type { CabinetStore, Reader, RunStore } from "../ports";
import { toRunDocument } from "../repository";
import type { RunInput } from "../run-workflow";

type JobStatus = "running" | "waiting" | "done" | "skipped" | "failed";

/**
 * The work a Run's workflow steps do, so the steps only stream events: the
 * Run's rows, the Documents it may use (the Cabinet's and its Desk's own,
 * never another Desk's), the Rules, and the models behind the Reader port.
 */
export interface RunWorkService {
  begin(input: RunInput): Promise<RunState>;
  plan(ctx: RunContext, pipeline: PipelineId, jobs: JobId[]): Promise<void>;
  markJob(
    ctx: RunContext,
    index: number,
    job: JobId,
    status: JobStatus,
    summary?: string,
  ): Promise<void>;
  sort: Reader["sort"];
  read: Reader["read"];
  /** A Rule Job: pure code over what was read. */
  rule(job: JobId, state: RunState): ReturnType<typeof applyRuleJob>;
  /** The Rules propose each Hit's disposition; the model weighs any there are. */
  adjudicate(
    ctx: RunContext,
    state: RunState,
  ): Promise<{
    state: RunState;
    summary: string;
    question: ReturnType<typeof applyRuleJob>["outcome"]["question"];
    cost: Awaited<ReturnType<Reader["adjudicate"]>>["cost"];
  }>;
  decide: Reader["decide"];
  /** Documents on file that could meet a Need: the same Case files, or the Desk's uploads. */
  candidates(
    ctx: RunContext,
    kinds: RunDocument["kind"][],
    have: string[],
  ): Promise<{ id: string; name: string }[]>;
  /** Records a Question and marks the Run and its Job waiting; answers the Question's id. */
  ask(
    ctx: RunContext,
    question: {
      index: number;
      job: JobId;
      token: string;
      prompt: string;
      kinds: string[];
      options: { value: string; label: string }[];
      suggestions: { id: string; name: string }[];
    },
  ): Promise<string>;
  /** Records the Answer, puts the Run back to running, and gives the Documents it added. */
  answered(
    ctx: RunContext,
    questionId: string,
    answer: Answer,
  ): Promise<{ documents: RunDocument[]; names: string[] }>;
  finish(ctx: RunContext, state: RunState): Promise<void>;
  fail(ctx: RunContext, message: string): Promise<void>;
}

export type RunWorkPorts = {
  runs: Pick<
    RunStore,
    "update" | "recordJob" | "createQuestion" | "markAnswered"
  >;
  cabinet: Pick<CabinetStore, "byIds" | "asOf" | "candidates">;
  reader: Reader;
};

export function createRunWorkService(ports: RunWorkPorts): RunWorkService {
  const { runs, cabinet, reader } = ports;
  return {
    async begin(input) {
      const rows = await cabinet.byIds(input.documentIds, input.ctx.sessionId);
      const [asOf] = await Promise.all([
        cabinet.asOf(rows),
        runs.update(input.ctx.runId, { status: "running" }),
      ]);
      return {
        runId: input.ctx.runId,
        asOf,
        pipeline: input.pipeline ?? undefined,
        documents: rows.map(toRunDocument),
        checks: [],
        gaps: [],
        answers: [],
      };
    },

    plan: (ctx, pipeline, jobs) => runs.update(ctx.runId, { pipeline, jobs }),

    markJob: (ctx, index, job, status, summary) =>
      runs.recordJob({
        runId: ctx.runId,
        position: index,
        job,
        status,
        summary,
      }),

    sort: (ctx, document) => reader.sort(ctx, document),
    read: (ctx, document, kind, onField) =>
      reader.read(ctx, document, kind, onField),

    rule: (job, state) => applyRuleJob(state, job, WATCHLIST),

    async adjudicate(ctx, state) {
      const ruled = applyRuleJob(state, "adjudicate", WATCHLIST);
      if (!ruled.state.hits?.length)
        return {
          state: ruled.state,
          summary: ruled.outcome.summary,
          question: ruled.outcome.question,
          cost: null,
        };
      const { hits, cost } = await reader.adjudicate(ctx, state, WATCHLIST);
      const next = withChecks({ ...ruled.state, hits }, [screeningCheck(hits)]);
      const cleared = hits.filter(
        (hit) => hit.disposition === "false_positive",
      ).length;
      return {
        state: next,
        summary: `${hits.length} hit${hits.length === 1 ? "" : "s"} weighed, ${cleared} discounted`,
        question: ruled.outcome.question,
        cost,
      };
    },

    decide: (ctx, state) => reader.decide(ctx, state),

    candidates: (ctx, kinds, have) =>
      cabinet.candidates(
        ctx.sessionId,
        have,
        kinds.filter(Boolean) as string[],
      ),

    async ask(ctx, question) {
      const questionId = await runs.createQuestion({
        runId: ctx.runId,
        job: question.job,
        token: question.token,
        prompt: question.prompt,
        wants: {
          kinds: question.kinds,
          options: question.options,
          suggestions: question.suggestions,
        },
      });
      await Promise.all([
        runs.update(ctx.runId, { status: "waiting" }),
        runs.recordJob({
          runId: ctx.runId,
          position: question.index,
          job: question.job,
          status: "waiting",
          summary: question.prompt,
        }),
      ]);
      return questionId;
    },

    async answered(ctx, questionId, answer) {
      const [rows] = await Promise.all([
        answer.documentIds?.length
          ? cabinet.byIds(answer.documentIds, ctx.sessionId)
          : Promise.resolve([]),
        runs.markAnswered(questionId, answer),
        runs.update(ctx.runId, { status: "running" }),
      ]);
      return {
        documents: rows.map(toRunDocument),
        names: rows.map((row) => row.name),
      };
    },

    finish: (ctx, state) =>
      runs.update(ctx.runId, {
        status: "completed",
        state,
        pipeline: state.pipeline ?? null,
        recommendation: state.decision?.recommendation ?? null,
        document_ids: state.documents.map((document) => document.id),
        completed_at: new Date().toISOString(),
      }),

    fail: (ctx, message) =>
      runs.update(ctx.runId, {
        status: "failed",
        error: message.slice(0, 1000),
      }),
  };
}
