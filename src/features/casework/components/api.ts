"use client";

import {
  getJson,
  readNdjson,
  send,
  streamJson,
  withQuery,
} from "@/platform/client/api";
import {
  type AnswerResponse,
  type ChatRequest,
  type DeskStatusResponse,
  type DocumentPagesResponse,
  ROUTES,
  type StopResponse,
  type UploadRequest,
  type UploadSlot,
} from "../domain/api";
import type { ChatEvent } from "../domain/chat-events";
import type {
  ModelSettings,
  ModelSettingsByPurpose,
  Purpose,
} from "../domain/model-config";
import type { Answer, RunEvent } from "../domain/run-events";
import type { DeskView, DocView } from "../view";

/** Typed wrappers over the Casework routes; components never call `fetch` for them. */

/** The open Desk's Runs, the Owner's Desks and the Spend. */
export function getDeskStatus(init?: { signal?: AbortSignal }) {
  return getJson<DeskStatusResponse>(ROUTES.desk, init);
}

/** Signed pages for up to 60 Documents. */
export function getDocumentPages(
  ids: string[],
  init?: { signal?: AbortSignal },
) {
  return getJson<DocumentPagesResponse>(ROUTES.documentPages, {
    ...init,
    query: { ids: ids.join(",") },
  });
}

/** Opens a Desk with everything it shows: an earlier one by id, or the current one (created on first use). */
export function openDesk(deskId: string | null = null) {
  return send<DeskView>("PUT", ROUTES.desk, { deskId });
}

/** A fresh Desk, opened. */
export function newDesk() {
  return send<DeskView>("POST", ROUTES.desks);
}

export function saveModelSettings(purpose: Purpose, settings: ModelSettings) {
  return send<ModelSettingsByPurpose>("PUT", ROUTES.setting(purpose), settings);
}

export function resetModelSettings() {
  return send<ModelSettingsByPurpose>("DELETE", ROUTES.settings);
}

/** Stops one Run, or with none, whatever the Desk has going. */
export function stop(runId: string | null) {
  return send<StopResponse>(
    "POST",
    runId ? ROUTES.runStop(runId) : ROUTES.stop,
  );
}

export function answer(questionId: string, reply: Answer) {
  return send<AnswerResponse>("POST", ROUTES.answer(questionId), reply);
}

/** Slots to upload files to, one per file in order. */
export function beginUpload(files: UploadRequest[]) {
  return send<UploadSlot[]>("POST", ROUTES.uploads, { files });
}

/** Records finished uploads as Documents of the Desk. */
export function finishUpload(tickets: string[]) {
  return send<DocView[]>("POST", ROUTES.documents, { tickets });
}

/** One message to the Specialist; each ChatEvent is handed over as it arrives. */
export function sendMessage(
  message: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
) {
  return streamJson<ChatEvent>(ROUTES.chat, message, onEvent, { signal });
}

/** A Run's events from the `from`th on, until the stream ends. */
export async function followRun(
  runId: string,
  from: number,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetch(withQuery(ROUTES.runEvents(runId), { from }), {
    signal,
    cache: "no-store",
  });
  await readNdjson(response, onEvent);
}
