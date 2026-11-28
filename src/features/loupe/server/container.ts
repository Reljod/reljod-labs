import "server-only";
import { getRun, start } from "workflow/api";
import { container } from "@/platform/services/container";
import {
  CHECKS,
  type CheckId,
  DEFAULT_MODEL,
  type DocumentSource,
  MODEL_IDS,
  type RawMeasurement,
} from "../domain/contract";
import { RECORDED } from "../domain/corpus";
import { LIMITS } from "../domain/limits";
import { env } from "./env";
import { gatewayExaminer, scriptedExaminer } from "./examiner-model";
import { createLoupeMcpHandler } from "./mcp";
import type { ExaminationRuns, ToolkitSandbox } from "./ports";
import {
  auditRepository,
  examinationRepository,
  loupeRateLimiter,
  rulebookRepository,
  trailRepository,
  uploadRepository,
} from "./repository";
import { sampleBytes } from "./sample-files";
import {
  cropPage,
  disposeSandbox,
  prepareDocument,
  runCheck,
  runCode,
  runSweep,
} from "./sandbox";
import { createLoupeServices, type LoupeServices } from "./services";
import { download, signedUpload, storedSize, upload } from "./storage";
import { SandboxUnavailable } from "./toolkit";
import { loupeExamination } from "./workflow";

/** Loupe's own caps outside an Examination's (`loupe.rate_events`), per visitor or per Owner. */
const rate = loupeRateLimiter({
  check: {
    by: "visitor",
    limit: LIMITS.checksPerVisitorPerHour,
    windowHours: 1,
    what: "Checks",
  },
  reevaluate: {
    by: "owner",
    limit: LIMITS.reevaluatesPerOwnerPerHour,
    windowHours: 1,
    what: "re-evaluations",
  },
  token: {
    by: "owner",
    limit: LIMITS.mcpTokensPerOwnerPerDay,
    windowHours: 24,
    what: "tokens",
  },
});

/** Vercel Sandbox with no network (ADR 0022); `live` only where it is set up. */
const vercelSandbox: ToolkitSandbox = {
  get live() {
    return env.sandboxConfigured();
  },
  prepare: prepareDocument,
  sweep: runSweep,
  check: ({ source: _source, ...input }) => runCheck(input),
  code: runCode,
  crop: cropPage,
  dispose: disposeSandbox,
};

/** A Sample's recorded Sweep Measurements of one Check. */
function recordedCheck(
  source: DocumentSource,
  check: CheckId,
): RawMeasurement[] {
  if (source.kind !== "sample") return [];
  const metrics = CHECKS[check].metrics as readonly string[];
  return (RECORDED.get(source.sampleId)?.measurements ?? [])
    .filter((item) => metrics.includes(item.metric))
    .slice(0, 4)
    .map((item) => ({ ...item, layer: undefined }));
}

const UNAVAILABLE = "Sandbox unavailable: the stubbed e2e suite has none.";

/**
 * The stubbed e2e suite's Sandbox: nothing starts. Pages and the Sweep come
 * from the Sample's recording (`live: false`), a Check answers with the
 * recorded Measurements of its Metrics, and code runs answer with a canned
 * line.
 */
const recordedSandbox: ToolkitSandbox = {
  live: false,
  prepare: async () => {
    throw new SandboxUnavailable(UNAVAILABLE);
  },
  sweep: async () => {
    throw new SandboxUnavailable(UNAVAILABLE);
  },
  check: async ({ source, check }) => ({
    stdout: '{"ok": true, "recorded": true}',
    stderr: "",
    exitCode: 0,
    ms: 12,
    measurements: recordedCheck(source, check),
    layers: [],
    rejected: [],
  }),
  code: async () => ({
    stdout:
      "recorded run: no Sandbox in the e2e suite's scripted Examination\n",
    stderr: "",
    exitCode: 0,
    ms: 9,
    measurements: [],
    layers: [],
    rejected: [],
  }),
  crop: async () => null,
  dispose: async () => {},
};

/** The Workflow SDK: every Examination is one `loupeExamination` run. */
const workflowRuns: ExaminationRuns = {
  async start(examinationId) {
    const run = await start(loupeExamination, [{ examinationId }]);
    return run.runId;
  },
  async cancel(runId, reason) {
    await getRun(runId).cancel({ cancelReason: reason });
  },
};

/** The Examiner's model: the one asked for, else LOUPE_MODEL, else the default. */
function modelFor(asked?: string): string {
  const pick = asked || env.model();
  return (MODEL_IDS as string[]).includes(pick) ? pick : DEFAULT_MODEL;
}

/**
 * Loupe's composition root. Live: the model gateway and Vercel Sandbox.
 * Stubbed (e2e without `x-e2e-live: 1`, and everything an Examination it
 * started does later, in its workflow and through its tokens): the scripted
 * Examiner and the recorded Sandbox. Gates, caps, the database, Storage and
 * the Workflow SDK are real in both.
 */
export const loupe = container(
  ({ stub }): LoupeServices =>
    createLoupeServices({
      examinations: examinationRepository,
      trail: trailRepository,
      rulebooks: rulebookRepository,
      uploads: uploadRepository,
      audit: auditRepository,
      rate,
      store: { download, upload, signedUpload, storedSize },
      samples: sampleBytes,
      sandbox: stub ? recordedSandbox : vercelSandbox,
      model: stub ? scriptedExaminer : gatewayExaminer,
      runs: workflowRuns,
      mcp: (request) => mcpHandler(request),
      secret: env.rateLimitSalt,
      modelFor,
      stub,
      now: Date.now,
      strictTrail: process.env.NODE_ENV !== "production",
    }),
);

/**
 * The Loupe MCP server, on the services a token reaches: the route serves
 * it, and the in-app Examiner calls it in process.
 */
export const mcpHandler = createLoupeMcpHandler((stub) => loupe({ stub }));

/** Whether an Examination was started stubbed: it never changes, so it is kept per instance. */
const stubbed = new Map<string, boolean>();

/**
 * The Examiner's services for one Examination, for its workflow steps,
 * which run without a request: stubbed if the Examination was started by
 * the stubbed e2e suite (`state.stub`), live otherwise.
 */
export async function examinerFor(examinationId: string) {
  let stub = stubbed.get(examinationId);
  if (stub === undefined) {
    stub = (await examinationRepository.pulse(examinationId))?.stub ?? false;
    if (stubbed.size > 1000) stubbed.clear();
    stubbed.set(examinationId, stub);
  }
  return loupe({ stub }).examiner;
}
