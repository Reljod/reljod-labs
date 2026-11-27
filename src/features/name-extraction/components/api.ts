/**
 * Typed wrappers over Sieve's REST routes (domain/api.ts), on the platform
 * client. Components never call `fetch` for the demo's own routes.
 */
import {
  attempt,
  followNdjson,
  getJson,
  type Outcome,
  send,
} from "@/platform/client/api";
import {
  apiPath,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type RulebookListResponse,
  type RunListResponse,
  type RunResponse,
  type SaveRulebookRequest,
  type SaveRulebookResponse,
  type StartRunRequest,
  type StartRunResponse,
  type StopRunResponse,
  type TokenResponse,
} from "../domain/api";
import type { RunEvent } from "../domain/contract";

export { ApiError, getJson } from "@/platform/client/api";

type Init = { signal?: AbortSignal };

/** Reads that are never cached: they change while the page is open. */
export const api = {
  runs: (init?: Init) => getJson<RunListResponse>(apiPath.runs(), init),
  run: (runId: string, init?: Init) =>
    getJson<RunResponse>(apiPath.run(runId), init),
  rulebooks: (init?: Init) =>
    getJson<RulebookListResponse>(apiPath.rulebooks(), init),
  /** Follows a Run's Audit trail from `after` until the stream ends. */
  followEvents: (
    runId: string,
    after: number,
    onEvent: (event: RunEvent & { seq?: number }) => void,
    init?: Init,
  ) =>
    followNdjson(apiPath.runEvents(runId), onEvent, {
      query: { after },
      signal: init?.signal,
    }),
};

/** Writes: each resolves to what it wrote, or to the error to show where it was clicked. */
export const writes = {
  startRun: (input: StartRunRequest): Promise<Outcome<StartRunResponse>> =>
    attempt(() => send<StartRunResponse>("POST", apiPath.runs(), input)),
  stopRun: (runId: string): Promise<Outcome<StopRunResponse>> =>
    attempt(() => send<StopRunResponse>("POST", apiPath.stop(runId))),
  saveRulebook: (
    input: SaveRulebookRequest,
  ): Promise<Outcome<SaveRulebookResponse>> =>
    attempt(() =>
      send<SaveRulebookResponse>("POST", apiPath.rulebooks(), input),
    ),
  createUpload: (
    input: CreateUploadRequest,
  ): Promise<Outcome<CreateUploadResponse>> =>
    attempt(() => send<CreateUploadResponse>("POST", apiPath.uploads(), input)),
  mintToken: (): Promise<Outcome<TokenResponse>> =>
    attempt(() => send<TokenResponse>("POST", apiPath.tokens())),
};
