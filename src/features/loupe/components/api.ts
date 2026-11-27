"use client";

import {
  attempt,
  followNdjson,
  getJson,
  type Outcome,
  send,
} from "@/platform/client/api";
import {
  type AuditResponse,
  apiPath,
  type CheckRequest,
  type CheckResponse,
  type CorpusResponse,
  type ExaminationListResponse,
  type ExaminationResponse,
  type ReevaluateResponse,
  type RulebookListResponse,
  type SaveRulebookResponse,
  type StartRequest,
  type StartResponse,
  type StopResponse,
  type TokenResponse,
  type UploadRequest,
  type UploadResponse,
} from "../domain/api";
import type { StoredEvent } from "../domain/contract";

/**
 * Typed wrappers over Loupe's REST routes (domain/api.ts); components never
 * call `fetch` for them themselves. Reads throw an ApiError; writes resolve
 * with an Outcome a button shows where it was clicked.
 */

type Init = { signal?: AbortSignal };

/**
 * Reads an Examination's Trail as it is written: calls `onEvents` with each
 * line. Resolves when the stream ends (the `end` event, or the server's own
 * cut after a few minutes; the caller reconnects with the last seq it has).
 */
export function streamEvents(
  examinationId: string,
  after: number,
  onEvents: (events: StoredEvent[]) => void,
  signal: AbortSignal,
) {
  return followNdjson<StoredEvent>(
    apiPath.events(examinationId),
    (event) => onEvents([event]),
    { query: { after }, signal },
  );
}

export const api = {
  examinations: (init?: Init) =>
    getJson<ExaminationListResponse>(apiPath.examinations(), init),
  examination: (id: string, init?: Init) =>
    getJson<ExaminationResponse>(apiPath.examination(id), init),
  rulebooks: (init?: Init) =>
    getJson<RulebookListResponse>(apiPath.rulebooks(), init),
  corpus: (init?: Init) => getJson<CorpusResponse>(apiPath.corpus(), init),
  audit: (init?: Init) => getJson<AuditResponse>(apiPath.audit(), init),
};

export function startExamination(
  input: StartRequest,
): Promise<Outcome<StartResponse>> {
  return attempt(() =>
    send<StartResponse>("POST", apiPath.examinations(), input),
  );
}

/** The escape hatch: never asks first. */
export function stopExamination(
  examinationId: string,
): Promise<Outcome<StopResponse>> {
  return attempt(() => send<StopResponse>("POST", apiPath.stop(examinationId)));
}

export function reevaluateExamination(
  examinationId: string,
): Promise<Outcome<ReevaluateResponse>> {
  return attempt(() =>
    send<ReevaluateResponse>("POST", apiPath.reevaluate(examinationId)),
  );
}

export function runCheckAgain(
  examinationId: string,
  input: CheckRequest,
): Promise<Outcome<CheckResponse>> {
  return attempt(() =>
    send<CheckResponse>("POST", apiPath.checks(examinationId), input),
  );
}

export function saveRulebook(input: {
  rulebook: unknown;
  note?: string;
}): Promise<Outcome<SaveRulebookResponse>> {
  return attempt(() =>
    send<SaveRulebookResponse>("POST", apiPath.rulebooks(), input),
  );
}

export function createUpload(
  input: UploadRequest,
): Promise<Outcome<UploadResponse>> {
  return attempt(() => send<UploadResponse>("POST", apiPath.uploads(), input));
}

/** PUTs the file to its one-time signed Storage URL (not one of Loupe's routes). */
export async function putFile(signedUrl: string, file: File): Promise<boolean> {
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "content-type": file.type, "x-upsert": "false" },
    body: file,
  }).catch(() => null);
  return Boolean(put?.ok);
}

export function mintMcpToken(): Promise<Outcome<TokenResponse>> {
  return attempt(() => send<TokenResponse>("POST", apiPath.tokens()));
}
