/**
 * The browser's one client for Sieve's read routes (domain/api.ts). Writes
 * stay server actions. Components never call `fetch` for a read themselves.
 */
import {
  apiPath,
  type RulebookListResponse,
  type RunListResponse,
  type RunResponse,
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

/** A read route's JSON, or throws with the route's own `{ error }` (or the status). */
export async function getJson<T>(
  path: string,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
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

/** Reads that are never cached: they change while the page is open. */
export const api = {
  runs: (init?: { signal?: AbortSignal }) =>
    getJson<RunListResponse>(apiPath.runs(), init),
  run: (runId: string, init?: { signal?: AbortSignal }) =>
    getJson<RunResponse>(apiPath.run(runId), init),
  rulebooks: (init?: { signal?: AbortSignal }) =>
    getJson<RulebookListResponse>(apiPath.rulebooks(), init),
};
