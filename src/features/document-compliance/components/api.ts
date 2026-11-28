import {
  ApiError,
  attempt,
  getJson,
  type Outcome,
  readNdjson,
  send,
} from "@/platform/client/api";
import {
  type AuditQuery,
  type AuditResponse,
  type ReevaluateResponse,
  type ReviewRequest,
  ROUTES,
  type RuleListResponse,
  type RuleVersionsResponse,
  type RuleWriteResponse,
  type RunListResponse,
  type RunResponse,
  type StartRunResponse,
} from "../domain/api";
import type { RuleEdit, RuleEditError } from "../domain/rules";
import type { ScanEvent } from "../scan-events";
import type { StartResult } from "../view";

/**
 * Typed wrappers over the Document compliance routes (`domain/api.ts`);
 * components never call `fetch` for them. Reads throw an `ApiError`; writes
 * answer an `Outcome` the button that started them shows where it was clicked.
 */

type Init = { signal?: AbortSignal };

export const api = {
  runs: (init?: Init) => getJson<RunListResponse>(ROUTES.runs, init),
  run: (runId: string, init?: Init) =>
    getJson<RunResponse>(ROUTES.run(runId), init),
  rules: (init?: Init) => getJson<RuleListResponse>(ROUTES.rules, init),
  ruleVersions: (ruleId: string, init?: Init) =>
    getJson<RuleVersionsResponse>(ROUTES.ruleVersions(ruleId), init),
  audit: (filter: AuditQuery, init?: Init) =>
    getJson<AuditResponse>(ROUTES.audit, { query: filter, ...init }),
};

/**
 * Starts a Pre-screen. A cap that refuses it answers 429 with the latest
 * stored run of the pack, which the picker shows instead.
 */
export async function startPrescreen(packSlug: string): Promise<StartResult> {
  try {
    const { runId } = await send<StartRunResponse>("POST", ROUTES.runs, {
      packSlug,
    });
    return { status: "started", runId };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429) {
        const runId = error.body.runId;
        return {
          status: "limited",
          runId: typeof runId === "string" ? runId : null,
          message: error.message,
        };
      }
      return { status: "error", message: error.message };
    }
    return {
      status: "error",
      message:
        "Couldn't reach the server. Check your connection and try again.",
    };
  }
}

/** Evaluates a finished run again with the Owner's current Rules; no model is called. */
export function reevaluateRun(
  runId: string,
): Promise<Outcome<ReevaluateResponse>> {
  return attempt(() =>
    send<ReevaluateResponse>("POST", ROUTES.evaluations(runId)),
  );
}

/** A Reviewer's decision on a flagged Finding of the run's latest Evaluation. */
export function reviewFinding(
  runId: string,
  review: ReviewRequest,
): Promise<Outcome<void>> {
  return attempt(() => send("POST", ROUTES.reviews(runId), review));
}

/** A Rule write's result: the new Version, or why not (per Parameter when the Rule refused the edit). */
export type RuleWriteOutcome =
  | { ok: true; version: number }
  | { ok: false; message: string; errors?: RuleEditError[] };

async function ruleWrite(
  write: () => Promise<RuleWriteResponse>,
): Promise<RuleWriteOutcome> {
  try {
    return { ok: true, version: (await write()).version };
  } catch (error) {
    if (error instanceof ApiError) {
      const errors = error.body.errors;
      return {
        ok: false,
        message: error.message,
        errors: Array.isArray(errors) ? (errors as RuleEditError[]) : undefined,
      };
    }
    return {
      ok: false,
      message:
        "Couldn't reach the server. Check your connection and try again.",
    };
  }
}

/** Saves an edit to a Rule as its next Version. */
export function saveRule(ruleId: string, edit: RuleEdit) {
  return ruleWrite(() =>
    send<RuleWriteResponse>("PATCH", ROUTES.rule(ruleId), edit),
  );
}

/** Puts an earlier Version (0 for the Default) back in force as the next Version. */
export function restoreRule(ruleId: string, version: number) {
  return ruleWrite(() =>
    send<RuleWriteResponse>("POST", ROUTES.restoreVersion(ruleId, version)),
  );
}

/**
 * A live run's ScanEvents, from event `from` on, handed over as they arrive.
 * Resolves when the stream closes (the run ended, or the connection dropped).
 */
export async function streamRunEvents(
  runId: string,
  from: number,
  onEvent: (event: ScanEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${ROUTES.runEvents(runId)}?from=${encodeURIComponent(from)}`,
    { signal, cache: "no-store", headers: { accept: "application/x-ndjson" } },
  );
  await readNdjson<ScanEvent>(response, onEvent);
}
