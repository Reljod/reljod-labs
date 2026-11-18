/**
 * The browser's one client for the bank. Reads go through the gated GET
 * routes (`/api/bank/read/<command>`); writes are the `bankCommand` server
 * action. Components never call `fetch` for a read themselves.
 */
import { API_ROOT, readPath } from "../domain/api";
import type { ChatEvent, MessageView, SessionSummary } from "../domain/chat";
import type { CommandName, WriteOutcome } from "../domain/commands";
import type { ConfirmationView } from "../domain/views";
import { bankCommand } from "../server/actions";

/** A route's refusal, with its HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

async function refusalOf(response: Response): Promise<ApiError> {
  // The gate's 401 is plain text, not JSON: read text, parse only if it parses.
  const text = await response.text().catch(() => "");
  let message = text.trim();
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body?.error === "string") message = body.error;
  } catch {}
  return new ApiError(
    message && message.length < 300 ? message : response.statusText || `Request failed (${response.status})`,
    response.status,
  );
}

export async function getJson<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: init?.signal,
  });
  if (!response.ok) throw await refusalOf(response);
  return (await response.json()) as T;
}

/** One read command of the bank. `T` is the view type the command returns (domain/views.ts). */
export function readBank<T>(
  name: CommandName,
  input: Record<string, unknown> = {},
  init?: { signal?: AbortSignal },
): Promise<T> {
  return getJson<T>(readPath(name, input), init);
}

/**
 * One write command of the bank. A new idempotency key is made per call:
 * make the call once per click (see `useCommand`), and a retry of the same
 * request by the framework still runs once. Throws ApiError on a refusal.
 */
export async function runCommand<Result = unknown>(
  name: CommandName,
  input: Record<string, unknown>,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<WriteOutcome<Result>> {
  const answer = await bankCommand(name, input, idempotencyKey);
  if (!answer.ok) throw new ApiError(answer.error, 400, answer.errors);
  return answer.outcome as WriteOutcome<Result>;
}

export type SessionDetail = {
  session: SessionSummary;
  messages: MessageView[];
  confirmations: ConfirmationView[];
};

export const chatApi = {
  sessions: (init?: { signal?: AbortSignal }) =>
    getJson<{ sessions: SessionSummary[] }>(`${API_ROOT}/sessions`, init),
  session: (id: string, init?: { signal?: AbortSignal }) =>
    getJson<SessionDetail>(`${API_ROOT}/sessions/${id}`, init),
  /**
   * Sends one message and calls `onEvent` for each ChatEvent of the answer
   * as it streams. Resolves when the stream ends; rejects with ApiError when
   * the turn is refused before it starts.
   */
  async send(
    id: string,
    text: string,
    onEvent: (event: ChatEvent) => void,
    init?: { signal?: AbortSignal },
  ): Promise<void> {
    const response = await fetch(`${API_ROOT}/sessions/${id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: init?.signal,
    });
    if (!response.ok || !response.body) throw await refusalOf(response);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            onEvent(JSON.parse(line) as ChatEvent);
          } catch {}
        }
        newline = buffer.indexOf("\n");
      }
    }
  },
};
