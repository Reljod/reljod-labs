import {
  ApiError,
  attempt,
  errorOf,
  getJson,
  type Outcome,
  send,
  streamJson,
} from "@/platform/client/api";
import {
  API,
  type ConversationListResponse,
  type ConversationResponse,
  type RuleEditFailure,
  type RulesResponse,
  type TokenResponse,
  type TrailResponse,
} from "../domain/api";
import type { ChatEvent } from "../domain/chat";
import type { RuleEdit } from "../domain/rules";

/** The browser's way to the Canvas routes (`domain/api.ts`). Components call nothing else. */

export const conversations = (signal?: AbortSignal) =>
  getJson<ConversationListResponse>(API.conversations, { signal });

export const conversation = (id: string, signal?: AbortSignal) =>
  getJson<ConversationResponse>(API.conversation(id), { signal });

/** Deletes a Conversation and its Views, as a write button shows it. */
export const deleteConversation = (id: string) =>
  attempt(() => send("DELETE", API.conversation(id)));

export const rules = (signal?: AbortSignal) =>
  getJson<RulesResponse>(API.rules, { signal });

/**
 * Saves Rule edits as a new Version and answers the Rules as they now are;
 * a refusal carries one error per field at fault.
 */
export async function saveRules(
  edits: RuleEdit[],
): Promise<
  { ok: true; value: RulesResponse } | ({ ok: false } & RuleEditFailure)
> {
  let failure: unknown;
  const saved = await attempt(() =>
    send<RulesResponse>("POST", API.rules, { edits }).catch((error) => {
      failure = error;
      throw error;
    }),
  );
  if (saved.ok) return saved;
  const errors =
    failure instanceof ApiError
      ? (failure.body.errors as RuleEditFailure["errors"])
      : undefined;
  return { ok: false, error: saved.error, errors };
}

export const trail = (
  filter: { conversationId?: string | null },
  signal?: AbortSignal,
) =>
  getJson<TrailResponse>(API.trail, {
    query: { conversationId: filter.conversationId },
    signal,
  });

/** A token for an outside MCP client, shown once. */
export const mintToken = (): Promise<Outcome<TokenResponse>> =>
  attempt(() => send<TokenResponse>("POST", API.tokens));

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
  const result = await attempt(() =>
    send<ToolCallResult>("POST", API.appCall, input),
  );
  return result.ok
    ? result.value
    : { isError: true, content: [{ type: "text", text: result.error }] };
}

/** The View App's document, to put in a sandboxed frame's `srcdoc`. */
export async function appDocument(): Promise<string> {
  // HTML, not JSON: the one read `getJson` cannot make.
  const response = await fetch(API.appFrame);
  if (!response.ok) throw await errorOf(response);
  return response.text();
}

/**
 * Asks a Question and hands each event of the answer to `onEvent` as it
 * arrives. Rejects when the Question is refused before the stream starts.
 */
export const ask = (
  input: { text: string; conversationId?: string | null },
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
) =>
  streamJson<ChatEvent>(
    API.chat,
    {
      text: input.text,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    },
    onEvent,
    { signal },
  );
