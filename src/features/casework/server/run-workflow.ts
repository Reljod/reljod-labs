import { createHook, getWritable, sleep } from "workflow";
import { kindLabel } from "../domain/document-kinds";
import { applyRuleJob, isRuleJob } from "../domain/execute";
import { describeWant, JOBS, type JobId, unmet } from "../domain/jobs";
import {
  inferPipeline,
  PIPELINE_IDS,
  PIPELINES,
  type PipelineId,
} from "../domain/pipelines";
import { wantsInWords } from "../domain/rules/decision";
import { screeningCheck } from "../domain/rules/screening";
import type { Answer, RunEventInput } from "../domain/run-events";
import {
  type RunDocument,
  type RunState,
  withChecks,
} from "../domain/run-state";
import { WATCHLIST } from "../domain/watchlist";
import { emit, emitAll } from "./emit";
import type { RunContext } from "./jobs/context";
import { adjudicateWithModel, decideWithModel } from "./jobs/judge";
import { readDocument } from "./jobs/read";
import { sortDocument } from "./jobs/sort";
import {
  asOfFor,
  createQuestion,
  documentsByIds,
  markAnswered,
  recordJobRun,
  toRunDocument,
  updateRun,
} from "./repository";

/** How long a Question waits for a person before the Run goes on without it. */
const ANSWER_TIMEOUT = "30m";

export type RunInput = {
  ctx: RunContext;
  pipeline: PipelineId | null;
  /** Work the pipeline out from the sorted Documents. */
  inferPipeline: boolean;
  /** The Jobs to run; a pipeline's own list when a pipeline is given. */
  jobs: JobId[];
  documentIds: string[];
};

// Steps --------------------------------------------------------------------------

async function beginStep(input: RunInput): Promise<RunState> {
  "use step";
  const rows = await documentsByIds(input.documentIds, input.ctx.sessionId);
  const asOf = await asOfFor(rows);
  await updateRun(input.ctx.runId, { status: "running" });
  await emitAll([
    {
      type: "plan",
      pipeline: input.pipeline,
      jobs: input.jobs,
      inferred: false,
    },
    {
      type: "log",
      level: "info",
      text: `run ${input.ctx.runId.slice(0, 8)} · ${rows.length} document${rows.length === 1 ? "" : "s"} · as of ${asOf}`,
    },
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
}

async function planStep(
  ctx: RunContext,
  pipeline: PipelineId,
  jobs: JobId[],
  inferred: boolean,
) {
  "use step";
  await updateRun(ctx.runId, { pipeline, jobs });
  await emitAll([
    { type: "plan", pipeline, jobs, inferred },
    {
      type: "log",
      level: "info",
      text: `${inferred ? "inferred" : "planned"} ${pipeline}: ${jobs.join(" → ")}`,
    },
  ]);
}

async function markJobStep(
  ctx: RunContext,
  index: number,
  job: JobId,
  state: "start" | "done" | "skipped" | "waiting" | "error",
  summary?: string,
  ms?: number,
) {
  "use step";
  await recordJobRun({
    runId: ctx.runId,
    position: index,
    job,
    status:
      state === "start"
        ? "running"
        : state === "error"
          ? "failed"
          : state === "waiting"
            ? "waiting"
            : state,
    summary,
  });
  const events: RunEventInput[] = [
    { type: "job", index, job, state, summary, ms },
  ];
  if (state === "start") {
    events.push({ type: "log", level: "info", text: `▶ ${job}` });
  } else if (summary) {
    events.push({
      type: "log",
      level: state === "error" ? "error" : "info",
      text: `${state === "skipped" ? "↷" : state === "error" ? "✗" : "✓"} ${job}${ms ? ` (${(ms / 1000).toFixed(1)}s)` : ""}: ${summary}`,
    });
  }
  await emitAll(events);
}

async function sortStep(ctx: RunContext, document: RunDocument) {
  "use step";
  const { kind, gist, cost } = await sortDocument(ctx, document);
  await emitAll([
    {
      type: "document",
      documentId: document.id,
      name: document.name,
      kind,
      gist,
    },
    { type: "cost", ...cost },
    {
      type: "log",
      level: "info",
      text: `  sort ${document.name} → ${kind ?? "other"} · $${cost.costUsd.toFixed(4)}`,
    },
  ]);
  return { id: document.id, kind, gist };
}
sortStep.maxRetries = 2;

async function readStep(ctx: RunContext, document: RunDocument) {
  "use step";
  if (!document.kind)
    return { id: document.id, fields: {}, evidence: {}, parser: undefined };
  const kind = document.kind;
  const started = Date.now();
  const result = await readDocument(ctx, document, kind, (name, value) =>
    emit({ type: "field", documentId: document.id, name, value }),
  );
  // Evidence arrives with the finished reading; send it so the page can box each field.
  await emitAll([
    ...Object.entries(result.evidence).map(
      ([name, evidence]): RunEventInput => ({
        type: "field",
        documentId: document.id,
        name,
        value: result.fields[name],
        evidence,
      }),
    ),
    { type: "cost", ...result.cost },
    {
      type: "log",
      level: "info",
      text: `  read ${document.name} · ${result.parser}${result.spanCount ? ` ${result.spanCount} spans` : ""} · ${Object.keys(result.fields).length} fields · ${((Date.now() - started) / 1000).toFixed(1)}s · $${result.cost.costUsd.toFixed(4)}`,
    },
  ]);
  return {
    id: document.id,
    fields: result.fields,
    evidence: result.evidence,
    parser: result.parser,
  };
}
readStep.maxRetries = 2;

/** Events for whatever a Job added to the state. */
function patchEvents(before: RunState, after: RunState): RunEventInput[] {
  const events: RunEventInput[] = [];
  for (const check of after.checks) {
    const old = before.checks.find((item) => item.id === check.id);
    if (!old || old.outcome !== check.outcome || old.detail !== check.detail) {
      events.push({ type: "check", check });
    }
  }
  if (after.hits && after.hits !== before.hits)
    events.push({ type: "hits", hits: after.hits });
  if (after.ownership && after.ownership !== before.ownership)
    events.push({ type: "ownership", ownership: after.ownership });
  if (after.arrears && after.arrears !== before.arrears)
    events.push({ type: "arrears", arrears: after.arrears });
  if (after.risk && after.risk !== before.risk)
    events.push({ type: "risk", risk: after.risk });
  return events;
}

async function ruleStep(_ctx: RunContext, job: JobId, state: RunState) {
  "use step";
  const { state: next, outcome } = applyRuleJob(state, job, WATCHLIST);
  await emitAll(patchEvents(state, next));
  return { state: next, summary: outcome.summary, question: outcome.question };
}

async function adjudicateStep(ctx: RunContext, state: RunState) {
  "use step";
  const ruled = applyRuleJob(state, "adjudicate", WATCHLIST);
  if (!ruled.state.hits?.length) {
    await emitAll(patchEvents(state, ruled.state));
    return {
      state: ruled.state,
      summary: ruled.outcome.summary,
      question: ruled.outcome.question,
    };
  }
  const { hits, cost } = await adjudicateWithModel(ctx, state, WATCHLIST);
  const next = withChecks({ ...ruled.state, hits }, [screeningCheck(hits)]);
  await emitAll([
    ...patchEvents(state, next),
    ...(cost ? [{ type: "cost" as const, ...cost }] : []),
  ]);
  const cleared = hits.filter(
    (hit) => hit.disposition === "false_positive",
  ).length;
  return {
    state: next,
    summary: `${hits.length} hit${hits.length === 1 ? "" : "s"} weighed, ${cleared} discounted`,
    question: ruled.outcome.question,
  };
}
adjudicateStep.maxRetries = 2;

async function decideStep(ctx: RunContext, state: RunState) {
  "use step";
  const { decision, cost } = await decideWithModel(ctx, state);
  await emitAll([
    { type: "decision", decision },
    ...(cost ? [{ type: "cost" as const, ...cost }] : []),
  ]);
  return { state: { ...state, decision }, summary: decision.headline };
}

async function askStep(
  ctx: RunContext,
  index: number,
  job: JobId,
  token: string,
  prompt: string,
  kinds: RunDocument["kind"][],
  options: { value: string; label: string }[],
) {
  "use step";
  const questionId = await createQuestion({
    runId: ctx.runId,
    job,
    token,
    prompt,
    wants: { kinds: kinds.filter(Boolean) as string[], options },
  });
  await updateRun(ctx.runId, { status: "waiting" });
  await recordJobRun({
    runId: ctx.runId,
    position: index,
    job,
    status: "waiting",
    summary: prompt,
  });
  await emitAll([
    { type: "job", index, job, state: "waiting", summary: prompt },
    {
      type: "question",
      questionId,
      job,
      prompt,
      kinds: kinds.filter(Boolean) as NonNullable<RunDocument["kind"]>[],
      options,
    },
    { type: "log", level: "warn", text: `? ${job} is waiting: ${prompt}` },
  ]);
  return questionId;
}

async function answeredStep(
  ctx: RunContext,
  questionId: string,
  answer: Answer,
) {
  "use step";
  await markAnswered(questionId, answer);
  await updateRun(ctx.runId, { status: "running" });
  const rows = answer.documentIds?.length
    ? await documentsByIds(answer.documentIds, ctx.sessionId)
    : [];
  const summary = rows.length
    ? `Added ${rows.map((row) => row.name).join(", ")}`
    : answer.choice
      ? `Chose ${answer.choice}`
      : answer.text
        ? answer.text
        : "Go on without it";
  await emitAll([
    { type: "answer", questionId, summary },
    { type: "log", level: "info", text: `↩ answered: ${summary}` },
  ]);
  return rows.map(toRunDocument);
}

async function finishStep(ctx: RunContext, state: RunState) {
  "use step";
  await updateRun(ctx.runId, {
    status: "completed",
    state,
    pipeline: state.pipeline ?? null,
    recommendation: state.decision?.recommendation ?? null,
    document_ids: state.documents.map((document) => document.id),
    completed_at: new Date().toISOString(),
  });
  await emit({ type: "end", status: "completed" });
  await getWritable().close();
}

async function failStep(ctx: RunContext, message: string) {
  "use step";
  await updateRun(ctx.runId, {
    status: "failed",
    error: message.slice(0, 1000),
  });
  await emitAll([
    { type: "log", level: "error", text: message },
    { type: "end", status: "failed", error: message },
  ]);
  await getWritable().close();
}

// Orchestration ---------------------------------------------------------------------

/** Puts one Question to the person and waits, up to the timeout, for an Answer. */
async function ask(
  ctx: RunContext,
  index: number,
  job: JobId,
  attempt: number,
  prompt: string,
  kinds: RunDocument["kind"][],
  options: { value: string; label: string }[] = [],
): Promise<{ answer: Answer; documents: RunDocument[] }> {
  const token = `casework:${ctx.runId}:${index}:${attempt}`;
  const hook = createHook<Answer>({ token });
  const questionId = await askStep(
    ctx,
    index,
    job,
    token,
    prompt,
    kinds,
    options,
  );
  const answer = await Promise.race([
    hook.then((payload) => payload),
    sleep(ANSWER_TIMEOUT).then(
      (): Answer => ({ skip: true, text: "No answer in time" }),
    ),
  ]);
  const documents = await answeredStep(ctx, questionId, answer);
  return { answer, documents };
}

/** Sorts and reads Documents that joined the Run, in parallel. */
async function intake(
  ctx: RunContext,
  documents: RunDocument[],
  read: boolean,
) {
  const sorted = await Promise.all(
    documents.map(async (document) => {
      if (document.kind) return document;
      const result = await sortStep(ctx, document);
      return { ...document, kind: result.kind ?? undefined, gist: result.gist };
    }),
  );
  if (!read) return sorted;
  return Promise.all(
    sorted.map(async (document) => {
      if (document.fields || !document.kind) return document;
      const result = await readStep(ctx, document);
      return {
        ...document,
        fields: result.fields,
        evidence: result.evidence,
        parser: result.parser,
      };
    }),
  );
}

function merge(state: RunState, documents: RunDocument[]): RunState {
  const byId = new Map(
    state.documents.map((document) => [document.id, document]),
  );
  for (const document of documents)
    byId.set(document.id, { ...byId.get(document.id), ...document });
  return { ...state, documents: [...byId.values()] };
}

/**
 * One Run: a Pipeline or a hand-picked set of Jobs over the chosen Documents.
 * Each Job checks what it needs first; when something is missing, the Run
 * asks the person and waits on a hook. A Pipeline left open is worked out
 * from the Documents once they are sorted.
 */
export async function caseworkRun(input: RunInput) {
  "use workflow";
  const { ctx } = input;
  try {
    let state = await beginStep(input);
    let jobs = [...input.jobs];
    let questions = 0;

    for (let index = 0; index < jobs.length; index++) {
      const job = jobs[index];
      await markJobStep(ctx, index, job, "start");
      const read = jobs.slice(0, index + 1).includes("read");

      // What it needs, asked for until given or waived.
      let missing = unmet(state, JOBS[job].needs(state));
      while (missing.length > 0) {
        const wanted = missing[0];
        if (questions >= 6) {
          state = {
            ...state,
            gaps: [
              ...state.gaps,
              { job, wants: describeWant(wanted).toLowerCase() },
            ],
          };
          missing = missing.slice(1);
          continue;
        }
        questions++;
        const { answer, documents } = await ask(
          ctx,
          index,
          job,
          questions,
          `I need the ${wantsInWords(wanted.kinds)} ${wanted.why}. Drop it here, or tell me to go on without it.`,
          wanted.kinds,
        );
        if (answer.text)
          state = {
            ...state,
            answers: [...state.answers, { job, text: answer.text }],
          };
        if (documents.length > 0) {
          state = merge(
            state,
            await intake(ctx, documents, read || job !== "sort"),
          );
        } else {
          state = {
            ...state,
            gaps: [
              ...state.gaps,
              { job, wants: describeWant(wanted).toLowerCase() },
            ],
          };
          missing = missing.slice(1);
          continue;
        }
        missing = unmet(state, JOBS[job].needs(state));
      }

      let summary = "";
      if (job === "sort") {
        state = merge(state, await intake(ctx, state.documents, false));
        const kinds = state.documents.flatMap((document) =>
          document.kind ? [document.kind] : [],
        );
        summary = state.documents
          .map((document) => kindLabel(document.kind ?? "other"))
          .join(", ");
        if (!state.pipeline && input.inferPipeline) {
          let pipeline = inferPipeline(kinds);
          if (!pipeline) {
            questions++;
            const { answer } = await ask(
              ctx,
              index,
              job,
              questions,
              "Which review is this?",
              [],
              PIPELINE_IDS.map((id) => ({
                value: id,
                label: PIPELINES[id].title,
              })),
            );
            pipeline = PIPELINE_IDS.find((id) => id === answer.choice) ?? null;
          }
          if (pipeline) {
            state = { ...state, pipeline };
            jobs = [...PIPELINES[pipeline].jobs];
            await planStep(ctx, pipeline, jobs, true);
          }
        }
      } else if (job === "read") {
        state = merge(state, await intake(ctx, state.documents, true));
        summary = `${state.documents.filter((document) => document.fields).length} documents read`;
      } else if (job === "adjudicate" || job === "decide" || isRuleJob(job)) {
        const result =
          job === "adjudicate"
            ? await adjudicateStep(ctx, state)
            : job === "decide"
              ? await decideStep(ctx, state)
              : await ruleStep(ctx, job, state);
        state = result.state;
        summary = result.summary;
        const question = "question" in result ? result.question : undefined;
        if (question && questions < 6) {
          questions++;
          const { answer, documents } = await ask(
            ctx,
            index,
            job,
            questions,
            question.prompt,
            question.kinds,
          );
          if (answer.text)
            state = {
              ...state,
              answers: [...state.answers, { job, text: answer.text }],
            };
          if (documents.length > 0) {
            state = merge(state, await intake(ctx, documents, true));
            const again =
              job === "adjudicate"
                ? await adjudicateStep(ctx, state)
                : await ruleStep(ctx, job, state);
            state = again.state;
            summary = again.summary;
          } else {
            state = {
              ...state,
              gaps: [
                ...state.gaps,
                { job, wants: wantsInWords(question.kinds) },
              ],
            };
          }
        }
      }
      await markJobStep(ctx, index, job, "done", summary);
    }

    // A single Job run still ends with a decision when it produced checks.
    if (!jobs.includes("decide") && state.checks.length > 0) {
      const result = await decideStep(ctx, state);
      state = result.state;
    }
    await finishStep(ctx, state);
    return {
      runId: ctx.runId,
      recommendation: state.decision?.recommendation ?? null,
    };
  } catch (error) {
    await failStep(ctx, error instanceof Error ? error.message : String(error));
    return { runId: ctx.runId, recommendation: null };
  }
}
