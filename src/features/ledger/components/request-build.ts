import { type BuildEvent, decodeEvents } from "../domain/build-events";

/** Asks for the next Build of a session and hands each streamed event to `onEvent`. */
export async function requestBuild(
  sessionId: string,
  question: string,
  onEvent: (event: BuildEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`/ask/${sessionId}/builds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Ledger could not start (${response.status})`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const { events, rest } = decodeEvents(buffer + value);
    buffer = rest;
    for (const event of events) onEvent(event);
  }
  for (const event of decodeEvents(`${buffer}\n`).events) onEvent(event);
}
