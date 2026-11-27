"use client";

import {
  attempt,
  getJson,
  type Outcome,
  send,
  streamJson,
} from "@/platform/client/api";
import {
  type Allowance,
  type AskAnswer,
  ROUTES,
  type Source,
  type UploadTicket,
  type WalkEvent,
} from "../domain/api";

/** Typed wrappers over the Floorwalk routes; components never call `fetch` themselves. */

export async function getAllowance(): Promise<Allowance | null> {
  return getJson<Allowance>(ROUTES.allowance).catch(() => null);
}

/** A one-time upload URL for the visitor's own footage. */
export function prepareUpload(file: {
  type: string;
  size: number;
}): Promise<Outcome<UploadTicket>> {
  return attempt(() => send<UploadTicket>("POST", ROUTES.uploads, file));
}

/** Starts a live Walk and hands each NDJSON event over as it arrives. */
export async function streamWalk(
  source: Source,
  signal: AbortSignal,
  onEvent: (event: WalkEvent) => void,
) {
  let ended = false;
  await streamJson<WalkEvent>(
    ROUTES.walks,
    { source },
    (event) => {
      if (event.t === "done" || event.t === "error") ended = true;
      onEvent(event);
    },
    { signal },
  );
  // A dropped connection or a function timeout closes the stream quietly.
  if (!ended) throw new Error("The Walk ended early. Try it again.");
}

/** PUTs the file to its one-time signed URL, reporting progress from 0 to 1. */
export function putFile(
  url: string,
  file: File,
  onProgress: (share: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`The upload was refused (${request.status}).`));
    request.onerror = () =>
      reject(
        new Error("The upload failed. Check the connection and try again."),
      );
    request.send(file);
  });
}

export function askFootage(
  source: Source,
  question: string,
): Promise<AskAnswer> {
  return send<AskAnswer>("POST", ROUTES.asks, { source, question });
}
