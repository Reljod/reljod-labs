import "server-only";
import { getRun, resumeHook, start } from "workflow/api";
import type { RunEvent } from "../domain/run";
import type { Workflows } from "./ports";
import { PIPELINE_WORKFLOWS } from "./run-workflow";

/** The Workflow SDK, as the Runs service reaches it. */
export const workflowSdk: Workflows = {
  async start(ctx) {
    const run = await start(PIPELINE_WORKFLOWS[ctx.pipelineId], [ctx]);
    return run.runId;
  },

  async cancel(workflowRunId, reason) {
    await getRun(workflowRunId).cancel({ cancelReason: reason });
  },

  async resume(hookToken, answer) {
    await resumeHook(hookToken, answer);
  },

  reader: (workflowRunId, startIndex) =>
    getRun(workflowRunId).getReadable<RunEvent>({ startIndex }).getReader(),

  async close(workflowRunId, event) {
    try {
      const writer = getRun(workflowRunId).getWritable<RunEvent>().getWriter();
      await writer.write({
        ...event,
        seq: -1,
        at: new Date().toISOString(),
      } as RunEvent);
      await writer.close();
    } catch {
      // The events route ends the stream of a Run that is over by itself.
    }
  },
};
