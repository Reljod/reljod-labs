/**
 * The browser's one client for the Operator's REST routes (domain/api.ts),
 * typed wrappers over `@/platform/client/api`. Every failure is an
 * `ApiError` carrying the message the route chose to show. Components never
 * call `fetch` for the demo's own routes.
 */
import { ApiError, followNdjson, getJson, send } from "@/platform/client/api";
import {
  apiPath,
  type ManifestListResponse,
  type ManifestUploadSlot,
  type McpToken,
  type NewRunRequest,
  type RulebookListResponse,
  type RunListResponse,
  type RunResponse,
  replayPath,
  type SavedRulebook,
  type StartedRun,
  type StoppedRun,
} from "../domain/api";
import type { ManifestSummary, RunEvent } from "../domain/contract";
import type { Rulebook } from "../domain/rules";

export { ApiError };

type Init = { signal?: AbortSignal };

export const api = {
  runs: (init?: Init) => getJson<RunListResponse>(apiPath.runs(), init),
  run: (runId: string, init?: Init) =>
    getJson<RunResponse>(apiPath.run(runId), init),
  /** A Run's Trail after `after`, line by line, until it ends or the server closes it. */
  follow: (
    runId: string,
    after: number,
    onEvent: (event: RunEvent) => void,
    init?: Init,
  ) => followNdjson<RunEvent>(apiPath.runEvents(runId, after), onEvent, init),
  rulebooks: (init?: Init) =>
    getJson<RulebookListResponse>(apiPath.rulebooks(), init),
  manifests: (init?: Init) =>
    getJson<ManifestListResponse>(apiPath.manifests(), init),
  /** A recorded Run shipped with the site: a static file, so the browser may cache it. */
  replay: (taskId: string, init?: Init) =>
    getJson<RunResponse>(replayPath.run(taskId), init),

  /** Starts a Run the Operator keys, or files a "take the keyboard" attempt. */
  startRun: (request: NewRunRequest) =>
    send<StartedRun>("POST", apiPath.runs(), request),
  stopRun: (runId: string) => send<StoppedRun>("POST", apiPath.stop(runId)),
  decide: (
    runId: string,
    approvalId: string,
    decision: "approved" | "refused",
  ) =>
    send<{ ok: true }>("PATCH", apiPath.approval(runId, approvalId), {
      decision,
    }),
  saveRulebook: (rulebook: Rulebook, note?: string) =>
    send<SavedRulebook>("POST", apiPath.rulebooks(), { rulebook, note }),
  openManifestUpload: (file: { name: string; size: number }) =>
    send<ManifestUploadSlot>("POST", apiPath.manifests(), file),
  readManifest: (manifestId: string) =>
    send<ManifestSummary>("POST", apiPath.readManifest(manifestId)),
  mintToken: () => send<McpToken>("POST", apiPath.tokens()),
};
