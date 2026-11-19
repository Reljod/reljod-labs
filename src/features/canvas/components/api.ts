import { API, type ErrorResponse } from "../domain/api";
import type { ChatEvent } from "../domain/chat";
import { CHAT_STUB_HEADER } from "../domain/stub";

/** The browser's way to the Canvas routes (`domain/api.ts`). Components call nothing else. */

async function errorOf(response: Response) {
  const body = (await response
    .json()
    .catch(() => null)) as ErrorResponse | null;
  return new Error(body?.error ?? `The request failed (${response.status}).`);
}

export async function getJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, { signal, cache: "no-store" });
  if (!response.ok) throw await errorOf(response);
  return (await response.json()) as T;
}

/** A CallToolResult as the MCP server gave it. */
export type ToolCallResult = {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

/** An App's `tools/call`, through the Host's proxy route. A refusal comes back as a tool error. */
export async function callApp(input: {
  name: string;
  arguments: Record<string, unknown>;
}): Promise<ToolCallResult> {
  const response = await fetch(API.appCall, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: input.name, arguments: input.arguments }),
  });
  if (!response.ok) {
    const error = await errorOf(response);
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
  return (await response.json()) as ToolCallResult;
}

/** The View App's document, to put in a sandboxed frame's `srcdoc`. */
export async function appDocument(): Promise<string> {
  const response = await fetch(API.appFrame);
  if (!response.ok) throw await errorOf(response);
  return response.text();
}

/**
 * Asks a Question and hands each event of the answer to `onEvent` as it
 * arrives. Rejects when the Question is refused before the stream starts.
 */
export async function ask(
  input: { text: string; conversationId?: string | null; stub?: boolean },
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetch(API.chat, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.stub ? { [CHAT_STUB_HEADER]: "1" } : {}),
    },
    body: JSON.stringify({
      text: input.text,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    }),
    signal,
  });
  if (!response.ok || !response.body) throw await errorOf(response);
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
        } catch {
          // A torn line: the stream was cut; the next read ends it.
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
}
