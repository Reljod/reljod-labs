import "server-only";
import { container } from "@/platform/services/container";
import { approvalStore, runStore, trailStore } from "./adapters";
import { stubCode, vercelCode } from "./code-sandbox";
import { modelOperator, scriptedOperator } from "./operator";
import { stubScreen } from "./sandbox/stub-screen";
import { vercelScreen } from "./screen";
import { createRunStepsService } from "./services/steps";
import { frameStore } from "./storage";

/**
 * The composition root of what a Run does (`services/steps.ts`), for the
 * workflow's steps (`run-steps.ts`) and for the Runs service. Kept apart from
 * `container.ts`, which starts the workflow and so imports it, so the steps
 * never import the MCP server or the routes. Live: the model and a Vercel
 * Sandbox per Run. Stubbed (a Run started by the e2e suite without
 * `x-e2e-live: 1`, marked `stubbed` on its row and its context): the scripted
 * Operator and the in-process Screen, which runs the same HARBOURMASTER and
 * Guard. The database, Storage, the caps and the checks are real in both.
 */
export const runSteps = container(({ stub }) =>
  createRunStepsService({
    runs: runStore,
    trail: trailStore,
    approvals: approvalStore,
    frames: frameStore,
    screen: stub ? stubScreen : vercelScreen,
    code: stub ? stubCode : vercelCode,
    operator: stub ? scriptedOperator : modelOperator,
    now: Date.now,
  }),
);
