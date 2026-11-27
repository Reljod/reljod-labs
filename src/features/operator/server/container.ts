import "server-only";
import { getRun, resumeHook, start } from "workflow/api";
import { env as accessEnv } from "@/features/access/server/env";
import { guestPassOf } from "@/features/access/server/repository";
import { container } from "@/platform/services/container";
import {
  approvalStore,
  manifestStore,
  rulebookStore,
  runStore,
  trailStore,
} from "./adapters";
import { env } from "./env";
import type { RunWorkflow } from "./ports";
import { operatorRun } from "./run-workflow";
import { stubScreen } from "./sandbox/stub-screen";
import { vercelScreen } from "./screen";
import { createOperatorServices } from "./services";
import { runSteps } from "./steps-container";
import { frameStore, manifestFiles } from "./storage";

/** `operatorRun` on the Workflow runtime: the durable loop of an Operator-driven Run. */
const workflow: RunWorkflow = {
  async start(ctx) {
    const run = await start(operatorRun, [{ ctx }]);
    return run.runId;
  },
  async cancel(workflowRunId, reason) {
    await getRun(workflowRunId).cancel({ cancelReason: reason });
  },
  async resume(token, answer) {
    await resumeHook(token, answer);
  },
};

/**
 * The Operator's composition root. Live: a Vercel Sandbox per Run and the
 * model (through `runSteps`). Stubbed (e2e without `x-e2e-live: 1`): the
 * in-process Screen and the scripted Operator, and every Run it starts is
 * marked `stubbed` so its workflow's steps get the same. The workflow, the
 * gates, the caps, the Guard, the checks, Storage and the database are real
 * in both.
 */
export const operator = container(({ stub }) =>
  createOperatorServices({
    runs: runStore,
    trail: trailStore,
    approvals: approvalStore,
    rulebooks: rulebookStore,
    manifests: manifestStore,
    manifestFiles,
    frames: frameStore,
    screen: stub ? stubScreen : vercelScreen,
    workflow,
    steps: runSteps({ stub }),
    access: {
      guestPass: guestPassOf,
      hostEmails: accessEnv.hostEmails,
      e2eEnabled: () => Boolean(env.e2eBypassToken()),
      secret: env.rateLimitSalt,
    },
    stub,
    now: Date.now,
  }),
);
