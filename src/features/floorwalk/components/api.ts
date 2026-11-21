"use client";

import {
  type Allowance,
  type AskAnswer,
  ROUTES,
  type Source,
  type WalkEvent,
} from "../domain/api";

async function errorOf(response: Response): Promise<string> {
  if (response.status === 401)
    return "Your guest access has ended. Sign in again to walk.";
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "Something went wrong on our side.";
}

export async function getAllowance(): Promise<Allowance | null> {
  const response = await fetch(ROUTES.allowance, { cache: "no-store" });
  return response.ok ? ((await response.json()) as Allowance) : null;
}

/** Starts a live Walk and hands each NDJSON event over as it arrives. */
export async function streamWalk(
  source: Source,
  signal: AbortSignal,
  onEvent: (event: WalkEvent) => void,
) {
  const response = await fetch(ROUTES.walks, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(await errorOf(response));
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines)
      if (line.trim()) onEvent(JSON.parse(line) as WalkEvent);
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as WalkEvent);
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

export async function askFootage(
  source: Source,
  question: string,
): Promise<AskAnswer> {
  const response = await fetch(ROUTES.asks, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, question }),
  });
  if (!response.ok) throw new Error(await errorOf(response));
  return (await response.json()) as AskAnswer;
}
