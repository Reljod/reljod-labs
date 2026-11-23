/**
 * The browser's only way to the server, by the contract in `domain/api.ts`.
 */
import {
  type Allowance,
  type DebriefEvent,
  type DebriefRequest,
  paths,
  type TurnEvent,
  type TurnRequest,
} from "../domain/api";

async function failureOf(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: string };
    return new Error(body.error ?? "Something went wrong.");
  } catch {
    return new Error(
      response.status === 401
        ? "Your guest pass has ended. Sign in again."
        : "Something went wrong.",
    );
  }
}

/** POSTs a request and yields each NDJSON line as it arrives. */
async function* stream<E>(
  url: string,
  body: unknown,
  signal: AbortSignal,
): AsyncGenerator<E> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) throw await failureOf(response);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) yield JSON.parse(line) as E;
      end = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as E;
}

export const api = {
  turn: (request: TurnRequest, signal: AbortSignal) =>
    stream<TurnEvent>(paths.turns, request, signal),
  debrief: (request: DebriefRequest, signal: AbortSignal) =>
    stream<DebriefEvent>(paths.debrief, request, signal),
  allowance: async (): Promise<Allowance> => {
    const response = await fetch(paths.allowance, { cache: "no-store" });
    if (!response.ok) throw await failureOf(response);
    return (await response.json()) as Allowance;
  },
};
