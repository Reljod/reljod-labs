import type {
  ManifestSummary,
  RulebookVersion,
  RunDetail,
  RunSummary,
} from "./contract";

/**
 * The Operator's read routes under `/api/operator/`: where each lives and
 * what it answers. Reads are GET routes, never server actions (Next sends a
 * browser's actions one at a time); writes are server actions
 * (server/actions.ts). The browser calls these only through
 * `components/api.ts`. Every route passes the Access gate and scopes what it
 * reads to the Owner. Errors are JSON `{ error }` with 400, 401, 404 or 500.
 */
export const API_ROOT = "/api/operator";

const id = (value: string) => encodeURIComponent(value);

export const apiPath = {
  runs: () => `${API_ROOT}/runs`,
  run: (runId: string) => `${API_ROOT}/runs/${id(runId)}`,
  runEvents: (runId: string, after: number) =>
    `${API_ROOT}/runs/${id(runId)}/events?after=${after}`,
  /** The picture of one Frame (PNG). Never changes, so the browser may keep it. */
  frame: (runId: string, n: number) =>
    `${API_ROOT}/runs/${id(runId)}/frames/${n}`,
  rulebooks: () => `${API_ROOT}/rulebooks`,
  manifests: () => `${API_ROOT}/manifests`,
  mcp: () => `${API_ROOT}/mcp`,
};

/** Recorded Runs shipped with the site: static files, synthetic data, no spend. */
export const REPLAY_ROOT = "/operator/replays";
export const replayPath = {
  run: (taskId: string) => `${REPLAY_ROOT}/${id(taskId)}/run.json`,
  frame: (taskId: string, n: number) =>
    `${REPLAY_ROOT}/${id(taskId)}/frames/${n}.png`,
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

/** GET runs: the Owner's Runs, newest first. */
export type RunListResponse = RunSummary[];
/** GET runs/[runId]: the Run with its Trail and Findings. */
export type RunResponse = RunDetail;
/** GET rulebooks: every version, newest first, then the Default; the first is current. */
export type RulebookListResponse = RulebookVersion[];
/** GET manifests: the Owner's attached Manifests, newest first. */
export type ManifestListResponse = ManifestSummary[];
