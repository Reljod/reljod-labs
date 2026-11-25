"use client";

import {
  type Allowance,
  type PassEvent,
  type PassRequest,
  paths,
} from "../domain/api";

/** The only place the browser calls Vellum's routes (`domain/api.ts`). */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function failed(response: Response): Promise<never> {
  let message = "Something went wrong. Try again.";
  try {
    const text = await response.text();
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      // The gate answers in plain text.
      if (text && text.length < 200) message = text;
    }
  } catch {
    // Keep the default.
  }
  throw new ApiError(message, response.status);
}

export async function getAllowance(signal?: AbortSignal): Promise<Allowance> {
  const response = await fetch(paths.allowance, { cache: "no-store", signal });
  if (!response.ok) return failed(response);
  return (await response.json()) as Allowance;
}

/** Starts a Pass and yields its events as they arrive. */
export async function* streamPass(
  request: PassRequest,
  signal: AbortSignal,
): AsyncGenerator<PassEvent> {
  const response = await fetch(paths.passes, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) return failed(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as PassEvent;
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as PassEvent;
}
