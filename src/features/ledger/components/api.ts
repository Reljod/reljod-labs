"use client";

import { send, streamJson } from "@/platform/client/api";
import { ROUTES, type StartAskResult } from "../domain/api";
import type { BuildEvent } from "../domain/build-events";

/** Typed wrappers over Ledger's routes; components never call `fetch` themselves. */

/** Opens an Ask session for a question; the session page plays its first Build. */
export function startAskSession(question: string): Promise<StartAskResult> {
  return send<StartAskResult>("POST", ROUTES.sessions, { question });
}

/** Asks for the next Build of a session and hands each streamed event to `onEvent`. */
export function requestBuild(
  sessionId: string,
  question: string,
  onEvent: (event: BuildEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamJson<BuildEvent>(
    ROUTES.builds(sessionId),
    { question },
    onEvent,
    { signal },
  );
}
