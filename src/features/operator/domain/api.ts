import { z } from "zod";
import {
  handInputSchema,
  type ManifestSummary,
  modelSchema,
  type RulebookVersion,
  type RunDetail,
  type RunStatus,
  type RunSummary,
  taskRefSchema,
} from "./contract";
import { LIMITS } from "./limits";

/**
 * The Operator's REST routes under `/api/operator/`: where each lives, what
 * it takes and what it answers. The browser calls them only through
 * `components/api.ts`. Every route passes the Access gate and scopes what it
 * touches to the Owner; writes are same-origin only. Errors are JSON
 * `{ error }` with 400, 401, 403, 404, 409 or 429 (500 says nothing more).
 * `/api/operator/mcp` is the MCP server, on its own bearer token.
 */
export const API_ROOT = "/api/operator";

const id = (value: string) => encodeURIComponent(value);

export const apiPath = {
  /** GET the Owner's Runs; POST starts one (the Operator) or files one (by hand). */
  runs: () => `${API_ROOT}/runs`,
  /** GET one Run with its Trail and Findings. */
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  /** POST stops a Run. */
  stop: (runId: string) => `${API_ROOT}/runs/${id(runId)}/stop`,
  /** PATCH decides a paused Action's Approval. */
  approval: (runId: string, approvalId: string) =>
    `${API_ROOT}/runs/${id(runId)}/approvals/${id(approvalId)}`,
  /** GET streams the Trail as NDJSON. */
  runEvents: (runId: string, after: number) =>
    `${API_ROOT}/runs/${id(runId)}/events?after=${after}`,
  /** The picture of one Frame (PNG). Never changes, so the browser may keep it. */
  frame: (runId: string, n: number) =>
    `${API_ROOT}/runs/${id(runId)}/frames/${n}`,
  /** GET every version; POST saves the next. */
  rulebooks: () => `${API_ROOT}/rulebooks`,
  /** GET the Owner's read Manifests; POST opens an upload. */
  manifests: () => `${API_ROOT}/manifests`,
  /** POST reads an uploaded Manifest into rows. */
  readManifest: (manifestId: string) =>
    `${API_ROOT}/manifests/${id(manifestId)}/read`,
  /** POST mints a bearer token for an outside MCP client. */
  tokens: () => `${API_ROOT}/tokens`,
  mcp: () => `${API_ROOT}/mcp`,
};

/** Recorded Runs shipped with the site: static files, synthetic data, no spend. */
export const REPLAY_ROOT = "/operator/replays";
export const replayPath = {
  run: (taskId: string) => `${REPLAY_ROOT}/${id(taskId)}/run.json`,
  frame: (taskId: string, n: number) =>
    `${REPLAY_ROOT}/${id(taskId)}/frames/${n}.webp`,
};

/** Where a Frame's picture is: a recorded Run's is a static file. */
export function frameSrc(
  run: Pick<RunSummary, "id" | "taskId" | "replay">,
  n: number,
) {
  return run.replay && run.taskId
    ? replayPath.frame(run.taskId, n)
    : apiPath.frame(run.id, n);
}

// Request bodies ------------------------------------------------------------------------

/** POST runs: a Run the Operator keys, or a "take the keyboard" attempt to replay and check. */
export const newRunSchema = z.discriminatedUnion("driver", [
  z.object({
    driver: z.literal("operator"),
    task: taskRefSchema,
    manifestId: z.uuid({ error: "No such Manifest." }).nullish(),
    model: modelSchema.optional(),
  }),
  z.object({
    driver: z.literal("hand"),
    taskId: z.string().min(1).max(60),
    inputs: z.array(handInputSchema).min(1).max(LIMITS.handInputs),
    elapsedMs: z.number().min(0).max(86_400_000),
  }),
]);
export type NewRunRequest = z.infer<typeof newRunSchema>;

/** PATCH runs/[runId]/approvals/[approvalId]. */
export const decisionSchema = z.object({
  decision: z.enum(["approved", "refused"]),
});

/** POST rulebooks: checked against the Rulebook's schema by the service. */
export const saveRulebookSchema = z.object({
  rulebook: z.unknown(),
  note: z.string().max(2000).nullish(),
});

/** POST manifests: what the browser is about to upload. */
export const manifestUploadSchema = z.object({
  name: z.string().max(400),
  size: z.number(),
});

// Answers -------------------------------------------------------------------------------

/** GET runs: the Owner's Runs, newest first. */
export type RunListResponse = RunSummary[];
/** GET runs/[runId]: the Run with its Trail and Findings. */
export type RunResponse = RunDetail;
/** POST runs. */
export type StartedRun = { runId: string };
/** POST runs/[runId]/stop. */
export type StoppedRun = { runId: string; stopped: boolean; status: RunStatus };
/** GET rulebooks: every version, newest first, then the Default; the first is current. */
export type RulebookListResponse = RulebookVersion[];
/** POST rulebooks. */
export type SavedRulebook = { version: number };
/** GET manifests: the Owner's attached Manifests, newest first. */
export type ManifestListResponse = ManifestSummary[];
/** POST manifests: the row and the signed URL the browser PUTs the file to. */
export type ManifestUploadSlot = {
  manifestId: string;
  signedUrl: string;
  token: string;
  path: string;
};
/** POST tokens. */
export type McpToken = { token: string; expiresAt: string };
