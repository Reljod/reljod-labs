"use client";

import {
  type AuditListResponse,
  type AuditQuery,
  apiPath,
  type DeskResponse,
  type RunResponse,
} from "../domain/api";
import type { AuditEvent, DeskView, RunView } from "../domain/run";

/*
 * The browser's one client for the page's reads (`domain/api.ts`). Writes
 * are server actions; components never `fetch` a read themselves.
 */

/** What a route answered when it refused. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

const FALLBACK: Record<number, string> = {
  401: "Your access to the demos has ended. Reload the page to sign in again.",
  404: "There is no such Run.",
};

export async function getJson<T>(
  path: string,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(path, {
    signal: init?.signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const error =
      typeof body?.error === "string" && body.error
        ? body.error
        : (FALLBACK[response.status] ??
          (response.statusText || `The server answered ${response.status}.`));
    throw new ApiFailure(error, response.status);
  }
  return (await response.json()) as T;
}

export async function fetchDesk(signal?: AbortSignal): Promise<DeskView> {
  return (await getJson<DeskResponse>(apiPath.desk(), { signal })).desk;
}

/** The Run, or null when this Owner has no such Run. */
export async function fetchRun(
  runId: string,
  signal?: AbortSignal,
): Promise<RunView | null> {
  try {
    return (await getJson<RunResponse>(apiPath.run(runId), { signal })).run;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) return null;
    throw error;
  }
}

export async function fetchAudit(
  query: AuditQuery,
  signal?: AbortSignal,
): Promise<AuditEvent[]> {
  return (await getJson<AuditListResponse>(apiPath.audit(query), { signal }))
    .events;
}
