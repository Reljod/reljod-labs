import "server-only";
import { resumeHook, start } from "workflow/api";
import { E2E_VISITOR } from "@/features/document-compliance/server/rate-limit";
import { isJobId, type JobId, planJobs } from "../domain/jobs";
import { resolveSettings } from "../domain/model-config";
import { PIPELINES, type PipelineId } from "../domain/pipelines";
import type { Answer } from "../domain/run-events";
import {
  countRuns,
  createRun,
  documentsByIds,
  getQuestion,
  getRun,
  orgModelSettings,
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

export async function settingsFor(session: SessionRow) {
  const org = await orgModelSettings().catch(() => ({}));
  return resolveSettings(org, session.model_overrides ?? {});
}

export async function checkLimits(session: SessionRow) {
  if (session.visitor_hash === E2E_VISITOR) return;
  const now = Date.now();
  const [visitorRuns, dailyRuns, spend] = await Promise.all([
    countRuns({
      visitorHash: session.visitor_hash,
      since: new Date(now - 3_600_000),
    }),
    countRuns({ since: new Date(now - 86_400_000) }),
    sessionSpend(session.id),
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
  const spent = spend.reduce((sum, row) => sum + row.costUsd, 0);
  if (spent >= LIMITS.spendPerSession) {
    throw new LimitError(
      `This session has spent $${spent.toFixed(2)} on models, the demo's cap. Start a new desk to keep going.`,
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
