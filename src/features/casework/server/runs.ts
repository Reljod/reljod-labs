import "server-only";
import { getRun as getWorkflowRun, resumeHook, start } from "workflow/api";
import { E2E_VISITOR } from "@/features/document-compliance/server/rate-limit";
import { isJobId, type JobId, planJobs } from "../domain/jobs";
import { resolveSettings } from "../domain/model-config";
import { PIPELINES, type PipelineId } from "../domain/pipelines";
import type { Answer, RunEvent } from "../domain/run-events";
import {
  activeRuns,
  closeStoppedRun,
  countRuns,
  createRun,
  documentsByIds,
  getQuestion,
  getRun,
  orgModelSettings,
  type RunRow,
  type SessionRow,
  sessionSpend,
  updateRun,
} from "./repository";
import { caseworkRun } from "./run-workflow";

export const LIMITS = {
  runsPerVisitorPerHour: 12,
  runsPerDay: 250,
  /** USD a session may spend on models before the desk stops starting work. */
  spendPerSession: 2,
  documentsPerRun: 12,
};

export class LimitError extends Error {}

/** A Run older than this that still claims to be going has lost its workflow. */
const STALE_RUN_MS = 45 * 60_000;

/** The Run this desk has going, if any. Runs whose workflow is long gone are closed on the way. */
export async function activeRun(sessionId: string): Promise<RunRow | null> {
  const going = await activeRuns(sessionId);
  let live: RunRow | null = null;
  for (const run of going) {
    if (Date.now() - new Date(run.created_at).getTime() > STALE_RUN_MS) {
      await updateRun(run.id, {
        status: "stopped",
        completed_at: new Date().toISOString(),
      });
      await closeStoppedRun(run.id);
    } else {
      live ??= run;
    }
  }
  return live;
}

/**
 * Whether a Run could start now: the Documents exist, nothing else is
 * running, and the session has money left. The Specialist checks this before
 * it starts anything.
 */
export async function readiness(session: SessionRow, ids: string[]) {
  const [documents, running, spend] = await Promise.all([
    documentsByIds([...new Set(ids)], session.id),
    activeRun(session.id),
    sessionSpend(session.id),
  ]);
  const spent = spend.reduce((sum, row) => sum + row.costUsd, 0);
  const found = new Set(documents.map((document) => document.id));
  const problems: string[] = [];
  if (ids.length === 0) problems.push("No documents were given.");
  const unknown = ids.filter((id) => !found.has(id));
  if (unknown.length > 0)
    problems.push(
      `${unknown.length} document id${unknown.length === 1 ? " is" : "s are"} not in the Cabinet or this desk's uploads.`,
    );
  if (documents.length > LIMITS.documentsPerRun)
    problems.push(
      `A run takes at most ${LIMITS.documentsPerRun} documents; ${documents.length} were given.`,
    );
  if (running)
    problems.push(
      `Run ${running.id} is ${running.status === "waiting" ? "waiting on a question" : "still running"}. Stop it or let it finish first.`,
    );
  if (spent >= LIMITS.spendPerSession)
    problems.push("This session has reached its spend cap.");
  return {
    ready: problems.length === 0,
    problems,
    documents: documents.map((document) => ({
      id: document.id,
      name: document.name,
    })),
    activeRunId: running?.id ?? null,
    spendLeftUsd: Number(
      Math.max(0, LIMITS.spendPerSession - spent).toFixed(4),
    ),
  };
}

export async function settingsFor(session: SessionRow) {
  const org = await orgModelSettings().catch(() => ({}));
  return resolveSettings(org, session.model_overrides ?? {});
}

/** Stops new model work once a session has spent the demo's cap. */
export async function checkSpend(session: SessionRow) {
  if (session.visitor_hash === E2E_VISITOR) return;
  const spend = await sessionSpend(session.id);
  const spent = spend.reduce((sum, row) => sum + row.costUsd, 0);
  if (spent >= LIMITS.spendPerSession) {
    throw new LimitError(
      `This session has spent $${spent.toFixed(2)} on models, the demo's cap. Start a new desk to keep going.`,
    );
  }
}

export async function checkLimits(session: SessionRow) {
  if (session.visitor_hash === E2E_VISITOR) return;
  const now = Date.now();
  await checkSpend(session);
  const [visitorRuns, dailyRuns] = await Promise.all([
    countRuns({
      visitorHash: session.visitor_hash,
      since: new Date(now - 3_600_000),
    }),
    countRuns({ since: new Date(now - 86_400_000) }),
  ]);
  if (visitorRuns >= LIMITS.runsPerVisitorPerHour) {
    throw new LimitError(
      `That's ${LIMITS.runsPerVisitorPerHour} runs this hour. Give the desk a breather and try again later.`,
    );
  }
  if (dailyRuns >= LIMITS.runsPerDay) {
    throw new LimitError(
      "The desk has hit today's run limit. Try again tomorrow.",
    );
  }
}

export type StartedRun = {
  runId: string;
  pipeline: PipelineId | null;
  jobs: JobId[];
  documents: { id: string; name: string }[];
};

/**
 * Starts a Run of a pipeline, of some jobs (plus what they depend on), or,
 * with neither, of "work it out": sort first, then infer the pipeline.
 */
export async function startRun(
  session: SessionRow,
  input: {
    pipeline?: PipelineId | null;
    jobs?: string[];
    documentIds: string[];
  },
): Promise<StartedRun> {
  await checkLimits(session);
  const running = await activeRun(session.id);
  if (running) {
    throw new LimitError(
      `Run ${running.id} is ${running.status === "waiting" ? "waiting on a question" : "still running"}. Stop it or let it finish before starting another.`,
    );
  }
  const documents = await documentsByIds(
    [...new Set(input.documentIds)].slice(0, LIMITS.documentsPerRun),
    session.id,
  );
  const requested = (input.jobs ?? []).filter(isJobId);
  const pipeline = input.pipeline ?? null;
  const jobs: JobId[] = pipeline
    ? [...PIPELINES[pipeline].jobs]
    : requested.length > 0
      ? planJobs(requested)
      : ["sort"];
  if (documents.length === 0) {
    throw new LimitError(
      "None of those documents are in the Cabinet or this desk's uploads.",
    );
  }
  const documentIds = documents.map((document) => document.id);
  const runId = await createRun({
    sessionId: session.id,
    pipeline,
    jobs,
    documentIds,
    visitorHash: session.visitor_hash,
  });
  try {
    const run = await start(caseworkRun, [
      {
        ctx: {
          runId,
          sessionId: session.id,
          settings: await settingsFor(session),
        },
        pipeline,
        // Hand-picked jobs never trigger pipeline inference.
        inferPipeline: !pipeline && requested.length === 0,
        jobs,
        documentIds,
      },
    ]);
    await updateRun(runId, { workflow_run_id: run.runId });
  } catch (error) {
    await updateRun(runId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return {
    runId,
    pipeline,
    jobs,
    documents: documents.map((document) => ({
      id: document.id,
      name: document.name,
    })),
  };
}

/** Resumes a waiting Run with the person's answer. */
export async function answerQuestion(
  session: SessionRow,
  questionId: string,
  answer: Answer,
) {
  const question = await getQuestion(questionId);
  if (!question) throw new Error("No such question");
  const run = await getRun(question.run_id);
  if (!run || run.session_id !== session.id) {
    throw new Error("No such question");
  }
  if (question.answered_at) return { runId: run.id, alreadyAnswered: true };
  // Every answered Document is sorted and read by a model: cap it like a new Run.
  const documentIds = answer.documentIds?.length
    ? (
        await documentsByIds(
          [...new Set(answer.documentIds)].slice(0, LIMITS.documentsPerRun),
          session.id,
        )
      ).map((document) => document.id)
    : undefined;
  await resumeHook(question.token, {
    documentIds,
    choice: answer.choice?.slice(0, 100),
    text: answer.text?.slice(0, 500),
    skip: answer.skip,
  } satisfies Answer);
  return { runId: run.id, alreadyAnswered: false };
}

/**
 * Stops a Run: cancels its workflow, tells whoever is watching, and closes
 * its open Question. A model call already in flight still finishes and is
 * still billed; nothing after it starts.
 */
export async function stopRun(session: SessionRow, runId: string) {
  const run = await getRun(runId);
  if (!run || run.session_id !== session.id) throw new Error("No such run");
  if (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "stopped"
  ) {
    return { runId: run.id, stopped: false, status: run.status };
  }
  if (run.workflow_run_id) {
    const workflow = getWorkflowRun(run.workflow_run_id);
    await workflow.cancel({ cancelReason: "Stopped by the person" });
    try {
      const writer = workflow.getWritable<RunEvent>().getWriter();
      const at = Date.now();
      await writer.write({
        at,
        type: "log",
        level: "warn",
        text: "■ stopped by the person",
      });
      await writer.write({ at, type: "end", status: "stopped" });
      await writer.close();
    } catch {
      // The events route also ends the stream of a stopped Run by itself.
    }
  }
  await updateRun(run.id, {
    status: "stopped",
    completed_at: new Date().toISOString(),
  });
  await closeStoppedRun(run.id);
  return { runId: run.id, stopped: true, status: "stopped" as const };
}

/** Stops whatever this desk has going. */
export async function stopActiveRun(session: SessionRow) {
  const running = await activeRun(session.id);
  if (!running) return { runId: null, stopped: false };
  return stopRun(session, running.id);
}
