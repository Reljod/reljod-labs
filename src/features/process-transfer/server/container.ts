import "server-only";
import { randomUUID } from "node:crypto";
import { getRun as getWorkflowRun, start } from "workflow/api";
import { container } from "@/platform/services/container";
import type { RunEvent } from "../domain/run";
import { auditLog } from "./audit";
import { siteOrigin } from "./origin";
import type {
  RecordingStore,
  RunRepository,
  RunWorkflows,
  SettingsRepository,
} from "./ports";
import {
  activeRuns,
  createRun,
  editRuleOverrides,
  isActiveRunConflict,
  listRuns,
  markStopped,
  ownedRun,
  ownedRunWithCalls,
  resetForRedo,
  saveSettings,
  setRunFields,
  settingsOf,
  workTotals,
} from "./repository";
import { processTransferRun } from "./run-workflow";
import { createRunService } from "./services/runs";
import { createSettingsService } from "./services/settings";
import { objectSize, signedUrl, uploadsSince, uploadUrl } from "./storage";

const runRepository: RunRepository = {
  create: createRun,
  owned: ownedRun,
  ownedWithCalls: ownedRunWithCalls,
  list: (owner) => listRuns(owner),
  active: activeRuns,
  workTotals,
  markStopped,
  resetForRedo,
  setFields: setRunFields,
  isActiveRunConflict,
};

const settingsRepository: SettingsRepository = {
  of: settingsOf,
  save: saveSettings,
  editRuleOverrides,
};

const recordings: RecordingStore = {
  uploadUrl,
  objectSize,
  signedUrl: (path) => signedUrl(path),
  uploadsSince,
};

/** Runs as durable workflows; a stubbed request's Runs carry `stub`, so their steps call no model. */
function workflows(stub: boolean): RunWorkflows {
  return {
    async start(input) {
      const run = await start(processTransferRun, [{ ...input, stub }]);
      return run.runId;
    },
    async cancel(workflowRunId) {
      await getWorkflowRun(workflowRunId).cancel({
        cancelReason: "Stopped by the person",
      });
    },
    async announceStopped(workflowRunId, patch) {
      const writer = getWorkflowRun(workflowRunId)
        .getWritable<RunEvent>()
        .getWriter();
      const at = Date.now();
      await writer.write({ at, type: "patch", patch });
      await writer.write({
        at,
        type: "log",
        level: "warn",
        text: "■ Stopped by the person",
      });
      await writer.write({ at, type: "end", status: "stopped" });
      await writer.close();
    },
    events: (workflowRunId, from) =>
      getWorkflowRun(workflowRunId).getReadable<RunEvent>({ startIndex: from }),
  };
}

/**
 * Handover's composition root for requests: the REST routes and the page
 * share these services. `stub` (an e2e request without `x-e2e-live: 1`)
 * marks the Runs it starts, whose workflow steps then use the scripted
 * Analyst (`pipeline-container.ts`). Gates, caps, the workflow, Storage and
 * the database stay real.
 */
export const handover = container(({ stub }) => {
  const settings = createSettingsService({
    settings: settingsRepository,
    audit: auditLog,
  });
  const runs = createRunService({
    runs: runRepository,
    settings,
    audit: auditLog,
    store: recordings,
    workflows: workflows(stub),
    origin: siteOrigin,
    newId: randomUUID,
    now: Date.now,
  });
  return { runs, settings };
});

export type HandoverServices = ReturnType<typeof handover>;
