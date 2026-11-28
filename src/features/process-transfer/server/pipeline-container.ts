import "server-only";
import { container } from "@/platform/services/container";
import { auditLog } from "./audit";
import { runFeed } from "./emit";
import type { Analyst, PipelineRuns } from "./ports";
import { claimRun, pipelineRun, pipelineStatus } from "./repository";
import { createPipelineService } from "./services/pipeline";
import { checkRound, designPlan } from "./stages/deck";
import { extractProcess, verifyProcess } from "./stages/process";
import { scriptedAnalyst } from "./stages/scripted";
import { watchRecording } from "./stages/watch";

/** The models, through the AI Gateway; every call's cost is tracked on the Run. */
const modelAnalyst: Analyst = {
  watch: watchRecording,
  extract: extractProcess,
  verify: verifyProcess,
  design: designPlan,
  check: checkRound,
};

const pipelineRuns: PipelineRuns = {
  run: pipelineRun,
  status: pipelineStatus,
  claim: claimRun,
};

/**
 * The composition root of a Run's workflow steps (`run-workflow.ts`). Kept
 * apart from `container.ts`, which starts the workflow and so imports it. A
 * Run started by a stubbed e2e request carries `stub` in its input, and its
 * steps get the scripted Analyst instead of the models; the row, the feed,
 * the Checks and the Audit trail stay real.
 */
export const pipeline = container(({ stub }) =>
  createPipelineService({
    runs: pipelineRuns,
    feed: runFeed,
    audit: auditLog,
    analyst: stub ? scriptedAnalyst : modelAnalyst,
    now: Date.now,
  }),
);
