"use client";

import {
  type CallResponse,
  type CallsResponse,
  type FirstView,
  paths,
  type ReportResponse,
  type StartCallRequest,
  type StartCallResponse,
  type ToolRequest,
  type ToolResponse,
  type TrailResponse,
} from "../domain/api";
import type { ReportedEvent, TurnStreamPart } from "../domain/contract";

/** The only place the browser calls Switchboard's routes (`domain/api.ts`). */

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
      if (text && text.length < 200) message = text;
    }
  } catch {
    // Keep the default.
  }
  throw new ApiError(message, response.status);
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) return failed(response);
  return (await response.json()) as T;
}

async function post<T>(
  path: string,
  body?: unknown,
  keepalive = false,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    keepalive,
  });
  if (!response.ok) return failed(response);
  return (await response.json()) as T;
}

export const api = {
  state: () => get<FirstView>(paths.state),
  calls: () => get<CallsResponse>(paths.calls),
  call: (id: string, after = 0) =>
    get<CallResponse>(`${paths.call(id)}${after ? `?after=${after}` : ""}`),
  trail: () => get<TrailResponse>(paths.trail),
  start: (body: StartCallRequest) => post<StartCallResponse>(paths.calls, body),
  tool: (id: string, body: ToolRequest) =>
    post<ToolResponse>(paths.tools(id), body),
  report: (id: string, events: ReportedEvent[]) =>
    post<ReportResponse>(paths.events(id), { events }, true),
  end: (id: string) => post<CallResponse>(paths.end(id), {}, true),
  /** One typed Turn on the text Line, streamed. */
  async turn(id: string, text: string, onPart: (part: TurnStreamPart) => void) {
    const response = await fetch(paths.turns(id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok || !response.body) return failed(response);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onPart(JSON.parse(line) as TurnStreamPart);
        } catch {
          // A torn line: the next read completes it.
        }
      }
      if (done) break;
    }
  },
};

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
