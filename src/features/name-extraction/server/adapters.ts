import "server-only";
import { getRun as getWorkflowRun, start } from "workflow/api";
import type {
  EventRepository,
  RulebookRepository,
  RunRepository,
  RunWorkflows,
  UploadRepository,
  UploadStore,
} from "./ports";
import {
  allEvents,
  countUploadsSince,
  createRun,
  currentRulebook,
  endRunIfGoing,
  eventsAfter,
  getRunRow,
  insertEvents,
  insertRulebook,
  insertUpload,
  latestNames,
  ownedRun,
  ownedUpload,
  rulebookVersions,
  runsOf,
  updateRun,
} from "./repository";
import { nameExtractionRun } from "./run-workflow";
import { BUCKET, supabase } from "./supabase";

/*
 * Sieve's adapters: the SQL in `repository.ts` as the services' repositories,
 * the private bucket and the Workflow SDK. The paid ones (the models and the
 * Sandbox) are wired in `work-container.ts`, where the workflow's steps run.
 */

export const runRepository: RunRepository = {
  create: createRun,
  owned: ownedRun,
  get: getRunRow,
  list: runsOf,
  setWorkflow: (runId, workflowRunId) =>
    updateRun(runId, { workflow_run_id: workflowRunId }),
  endIfGoing: endRunIfGoing,
};

export const eventRepository: EventRepository = {
  append: (runId, events) => insertEvents(runId, events),
  after: eventsAfter,
  all: (runId) => allEvents(runId),
  latestNames,
};

export const rulebookRepository: RulebookRepository = {
  current: currentRulebook,
  versions: (owner) => rulebookVersions(owner),
  save: insertRulebook,
};

export const uploadRepository: UploadRepository = {
  insert: insertUpload,
  owned: ownedUpload,
  countSince: countUploadsSince,
};

/** `uploads/<owner hash>/<upload id>.json` in the private `name-extraction` bucket. */
export const uploadStore: UploadStore = {
  async signedUploadUrl(path) {
    const { data, error } = await supabase()
      .storage.from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    return error || !data
      ? null
      : { signedUrl: data.signedUrl, token: data.token };
  },
};

/** Runs as durable workflows; a stubbed request's Runs carry `ctx.stub` to every step. */
export function runWorkflows(stub: boolean): RunWorkflows {
  return {
    async start(ctx) {
      const run = await start(nameExtractionRun, [
        { ctx: stub ? { ...ctx, stub: true } : ctx },
      ]);
      return run.runId;
    },
    async cancel(workflowRunId) {
      await getWorkflowRun(workflowRunId).cancel({
        cancelReason: "Stopped by its Owner",
      });
    },
  };
}
