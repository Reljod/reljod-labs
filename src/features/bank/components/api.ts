/**
 * The browser's one client for the bank: typed wrappers over its REST
 * routes (`ROUTES` in domain/api.ts) on `@/platform/client/api`. Reads go
 * through `GET /api/bank/read/<command>`, writes through
 * `POST /api/bank/commands/<command>`. Components never call `fetch` for
 * the bank themselves.
 */
import {
  ApiError,
  attempt,
  getJson,
  type Outcome,
  send,
  streamJson,
} from "@/platform/client/api";
import { type McpTokenResponse, ROUTES, readPath } from "../domain/api";
import type { ChatEvent, MessageView, SessionSummary } from "../domain/chat";
import type { CommandName, WriteOutcome } from "../domain/commands";
import type { Staff } from "../domain/staff";
import type { ConfirmationView } from "../domain/views";

export { ApiError };

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

/** The per-field errors a refused Rule edit carries, if any. */
export function fieldErrorsOf(
  error: unknown,
): { field: string; message: string }[] {
  const errors = error instanceof ApiError ? error.body.errors : undefined;
  return Array.isArray(errors)
    ? (errors as { field: string; message: string }[])
    : [];
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
 * request still runs once. Throws ApiError on a refusal.
 */
export function runCommand<Result = unknown>(
  name: CommandName,
  input: Record<string, unknown>,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<WriteOutcome<Result>> {
  return send<WriteOutcome<Result>>("POST", ROUTES.command(name), {
    input,
    idempotencyKey,
  });
}

/** Becomes another Staff member of the Owner's own bank. */
export function switchStaff(staffId: string): Promise<Outcome<Staff>> {
  return attempt(() => send<Staff>("PUT", ROUTES.activeStaff, { staffId }));
}

/** A token for an outside MCP client, acting as the Staff member signed in now. */
export function mintToken(): Promise<Outcome<McpTokenResponse>> {
  return attempt(() => send<McpTokenResponse>("POST", ROUTES.tokens));
}

export type SessionDetail = {
  session: SessionSummary;
  messages: MessageView[];
  confirmations: ConfirmationView[];
};

export const chatApi = {
  sessions: (init?: { signal?: AbortSignal }) =>
    getJson<{ sessions: SessionSummary[] }>(ROUTES.sessions, init),
  session: (id: string, init?: { signal?: AbortSignal }) =>
    getJson<SessionDetail>(ROUTES.session(id), init),
  create: (customerId: string | null) =>
    attempt(() =>
      send<SessionSummary>("POST", ROUTES.sessions, { customerId }),
    ),
  remove: (id: string) => attempt(() => send("DELETE", ROUTES.session(id))),
  /**
   * Sends one message and calls `onEvent` for each ChatEvent of the answer
   * as it streams. Resolves when the stream ends; rejects with ApiError when
   * the turn is refused before it starts.
   */
  send: (
    id: string,
    text: string,
    onEvent: (event: ChatEvent) => void,
    init?: { signal?: AbortSignal },
  ) => streamJson<ChatEvent>(ROUTES.chat(id), { text }, onEvent, init),
};
