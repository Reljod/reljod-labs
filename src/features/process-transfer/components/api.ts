"use client";

import {
  ApiError,
  attempt,
  getJson,
  type Outcome,
  readNdjson,
  send,
  withQuery,
} from "@/platform/client/api";
import {
  type AuditListResponse,
  type AuditQuery,
  apiPath,
  type DeskResponse,
  type ModelsResponse,
  type RulesResponse,
  type RunResponse,
  type StartedResponse,
} from "../domain/api";
import type { ModelChoice } from "../domain/models";
import type { RuleOverride } from "../domain/rules";
import type {
  AuditEvent,
  DeskView,
  ExportKind,
  RunEvent,
  RunView,
  StartInput,
  UploadTicket,
} from "../domain/run";

/*
 * Typed wrappers over Handover's routes (`domain/api.ts`); components never
 * call `fetch` for them. Reads throw an `ApiError`; writes answer an
 * `Outcome` a button shows where it was clicked.
 */

export async function fetchDesk(signal?: AbortSignal): Promise<DeskView> {
  return (await getJson<DeskResponse>(apiPath.desk(), { signal })).desk;
}

/** The Run, or null when this Owner has no such Run. */
export async function fetchRun(
  runId: string,
  signal?: AbortSignal,
): Promise<RunView | null> {
  try {
    return (await getJson<RunResponse>(apiPath.run(runId), { signal })).run;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function fetchAudit(
  query: AuditQuery,
  signal?: AbortSignal,
): Promise<AuditEvent[]> {
  return (await getJson<AuditListResponse>(apiPath.audit(query), { signal }))
    .events;
}

/**
 * Follows a Run's events from the `from`th, handing each line over as it
 * arrives; `onOpen` runs once the route has answered, before the first
 * event (which may be a long Stage away). Resolves when the stream ends.
 */
export async function followRun(
  runId: string,
  from: number,
  handlers: { onOpen: () => void; onEvent: (event: RunEvent) => void },
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(withQuery(apiPath.runEvents(runId), { from }), {
    signal,
    headers: { accept: "application/x-ndjson" },
  });
  if (response.ok) handlers.onOpen();
  await readNdjson(response, handlers.onEvent);
}

export function createUpload(file: {
  name: string;
  size: number;
  type: string;
}): Promise<Outcome<UploadTicket>> {
  return attempt(() => send<UploadTicket>("POST", apiPath.uploads(), file));
}

export function startRun(input: StartInput): Promise<Outcome<string>> {
  return attempt(
    async () =>
      (await send<StartedResponse>("POST", apiPath.runs(), input)).runId,
  );
}

export function stopRun(runId: string): Promise<Outcome<void>> {
  return attempt(() => send("POST", apiPath.stop(runId)));
}

export function redoDeck(runId: string): Promise<Outcome<string>> {
  return attempt(
    async () =>
      (await send<StartedResponse>("POST", apiPath.redo(runId))).runId,
  );
}

export function recordExport(
  runId: string,
  kind: ExportKind,
): Promise<Outcome<void>> {
  return attempt(() => send("POST", apiPath.exports(runId), { kind }));
}

export function saveRule(
  ruleId: string,
  override: RuleOverride | null,
): Promise<Outcome<RulesResponse>> {
  return attempt(() =>
    send<RulesResponse>("PUT", apiPath.rule(ruleId), { override }),
  );
}

export function resetRules(): Promise<Outcome<RulesResponse>> {
  return attempt(() => send<RulesResponse>("DELETE", apiPath.rules()));
}

export function saveModels(models: ModelChoice): Promise<Outcome<ModelChoice>> {
  return attempt(
    async () =>
      (await send<ModelsResponse>("PUT", apiPath.models(), models)).models,
  );
}
