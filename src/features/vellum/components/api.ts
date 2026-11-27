"use client";

import { errorOf, getJson } from "@/platform/client/api";
import {
  type Allowance,
  type PassEvent,
  type PassRequest,
  paths,
} from "../domain/api";

export { ApiError } from "@/platform/client/api";

/** Typed wrappers over Vellum's routes (`domain/api.ts`); components never call `fetch` themselves. */

export function getAllowance(signal?: AbortSignal): Promise<Allowance> {
  return getJson<Allowance>(paths.allowance, { signal });
}

/**
 * Starts a Pass and yields its events as they arrive (pulled, so a Trace
 * that stops reading stops the download). A refusal before the stream (the
 * gate, a bad image, the cap) throws an ApiError with its status.
 */
export async function* streamPass(
  request: PassRequest,
  signal: AbortSignal,
): AsyncGenerator<PassEvent> {
  const response = await fetch(paths.passes, {
    method: "POST",
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) throw await errorOf(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines)
      if (line.trim()) yield JSON.parse(line) as PassEvent;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as PassEvent;
}
