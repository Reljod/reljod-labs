import {
  type AuditQuery,
  type AuditResponse,
  apiPath,
  type RuleListResponse,
  type RuleVersionsResponse,
  type RunListResponse,
  type RunResponse,
} from "../domain/api";

/**
 * The browser's one client for the demo's reads (`domain/api.ts`). Components
 * never fetch a read themselves; writes stay Server Actions.
 */

/** What a route answered when it refused: the message to show, and its status. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

const FALLBACK: Record<number, string> = {
  401: "Your access to the demos has ended. Open the demo again from the front door.",
  404: "Not found.",
};

export async function getJson<T>(
  path: string,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    signal: init?.signal,
  });
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  throw new ApiFailure(
    typeof body?.error === "string"
      ? body.error
      : (FALLBACK[response.status] ??
          (response.statusText ||
            `Could not load (${response.status}). Try again in a moment.`)),
    response.status,
  );
}

type Init = { signal?: AbortSignal };

export const api = {
  runs: (init?: Init) => getJson<RunListResponse>(apiPath.runs(), init),
  run: (runId: string, init?: Init) =>
    getJson<RunResponse>(apiPath.run(runId), init),
  rules: (init?: Init) => getJson<RuleListResponse>(apiPath.rules(), init),
  ruleVersions: (ruleId: string, init?: Init) =>
    getJson<RuleVersionsResponse>(apiPath.ruleVersions(ruleId), init),
  audit: (filter: AuditQuery, init?: Init) =>
    getJson<AuditResponse>(apiPath.audit(filter), init),
};
