/**
 * The browser's one client for Loupe's read routes (domain/api.ts). Writes
 * stay server actions. Components never call `fetch` for a read themselves.
 */
import {
  type AuditResponse,
  apiPath,
  type CorpusResponse,
  type ExaminationListResponse,
  type ExaminationResponse,
  type RulebookListResponse,
} from "../domain/api";
import type { StoredEvent } from "../domain/contract";

/** A read route's refusal, with its HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Init = { signal?: AbortSignal };

async function refusalOf(response: Response) {
  const text = await response.text().catch(() => "");
  let message = text.trim();
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // The gate answers in plain text.
  }
  return new ApiError(
    message && message.length < 200
      ? message
      : response.statusText || `Request failed (${response.status})`,
    response.status,
  );
}

/** A read route's JSON, or throws with the route's own `{ error }` (or the status). */
export async function getJson<T>(path: string, init?: Init): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: init?.signal,
  });
  if (!response.ok) throw await refusalOf(response);
  return (await response.json()) as T;
}

/**
 * Reads an Examination's Trail as it is written: calls `onEvents` with each
 * batch of lines. Resolves when the stream ends (the `end` event, or the
 * server's own cut after a few minutes; the caller reconnects with the last
 * seq it has).
 */
export async function streamEvents(
  examinationId: string,
  after: number,
  onEvents: (events: StoredEvent[]) => void,
  signal: AbortSignal,
) {
  const response = await fetch(apiPath.events(examinationId, after), {
    cache: "no-store",
    signal,
  });
  if (!response.ok || !response.body) throw await refusalOf(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    const events: StoredEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as StoredEvent);
      } catch {
        // A cut line: the reconnect brings it again.
      }
    }
    if (events.length) onEvents(events);
  }
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
