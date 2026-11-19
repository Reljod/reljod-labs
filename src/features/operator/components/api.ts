/**
 * The browser's one client for the Operator's read routes (domain/api.ts).
 * Writes stay server actions. Components never call `fetch` for a read
 * themselves.
 */
import {
  apiPath,
  type ManifestListResponse,
  type RulebookListResponse,
  type RunListResponse,
  type RunResponse,
  replayPath,
} from "../domain/api";

/** A read route's refusal, with its HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Init = { signal?: AbortSignal };

/** A read route's JSON, or throws with the route's own `{ error }` (or the status). */
export async function getJson<T>(
  path: string,
  init?: Init & { cache?: RequestCache },
): Promise<T> {
  const response = await fetch(path, {
    cache: init?.cache ?? "no-store",
    headers: { accept: "application/json" },
    signal: init?.signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text.trim();
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // The gate answers in plain text.
    }
    throw new ApiError(
      message && message.length < 200
        ? message
        : response.statusText || `Request failed (${response.status})`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export const api = {
  runs: (init?: Init) => getJson<RunListResponse>(apiPath.runs(), init),
  run: (runId: string, init?: Init) =>
    getJson<RunResponse>(apiPath.run(runId), init),
  rulebooks: (init?: Init) =>
    getJson<RulebookListResponse>(apiPath.rulebooks(), init),
  manifests: (init?: Init) =>
    getJson<ManifestListResponse>(apiPath.manifests(), init),
  /** A recorded Run shipped with the site: a static file, so the browser may cache it. */
  replay: (taskId: string, init?: Init) =>
    getJson<RunResponse>(replayPath.run(taskId), { ...init, cache: "default" }),
};
