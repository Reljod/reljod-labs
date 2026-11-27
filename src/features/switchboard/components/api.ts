"use client";

import { errorOf, getJson, send, streamJson } from "@/platform/client/api";
import {
  type CallResponse,
  type CallsResponse,
  type FirstView,
  paths,
  type ReportResponse,
  type RuleEditRequest,
  type SavedRuleResponse,
  type StartCallRequest,
  type StartCallResponse,
  type TokenResponse,
  type ToolRequest,
  type ToolResponse,
  type TrailResponse,
} from "../domain/api";
import type { ReportedEvent, TurnStreamPart } from "../domain/contract";

/** Typed wrappers over Switchboard's routes (`domain/api.ts`); components never call `fetch` themselves. */

/**
 * A POST that outlives the page (`keepalive`): the last transcript report and
 * the hang-up are sent as the tab closes. The shared `send` has no keepalive.
 */
async function sendKeepalive<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
  if (!response.ok) throw await errorOf(response);
  return (await response.json()) as T;
}

export const api = {
  state: () => getJson<FirstView>(paths.state),
  calls: () => getJson<CallsResponse>(paths.calls),
  call: (id: string, after = 0) =>
    getJson<CallResponse>(paths.call(id), {
      query: { after: after || undefined },
    }),
  trail: () => getJson<TrailResponse>(paths.trail),
  start: (body: StartCallRequest) =>
    send<StartCallResponse>("POST", paths.calls, body),
  tool: (id: string, body: ToolRequest) =>
    send<ToolResponse>("POST", paths.tools(id), body),
  report: (id: string, events: ReportedEvent[]) =>
    sendKeepalive<ReportResponse>(paths.events(id), { events }),
  end: (id: string) => sendKeepalive<CallResponse>(paths.end(id), {}),
  /** One typed Turn on the text Line, streamed. */
  turn: (id: string, text: string, onPart: (part: TurnStreamPart) => void) =>
    streamJson<TurnStreamPart>(paths.turns(id), { text }, onPart),
  saveRule: (ruleId: string, edit: RuleEditRequest) =>
    send<SavedRuleResponse>("PUT", paths.rule(ruleId), edit),
  restoreRule: (ruleId: string) =>
    send<SavedRuleResponse>("POST", paths.restore(ruleId)),
  resetBackOffice: () => send("POST", paths.reset),
  callbackNow: (callId: string) => send("POST", paths.callback(callId)),
  mintToken: () => send<TokenResponse>("POST", paths.tokens),
};

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
