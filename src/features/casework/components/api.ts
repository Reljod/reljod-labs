"use client";

import {
  apiPath,
  type DeskStatusResponse,
  type DocumentPagesResponse,
} from "../domain/api";

/**
 * GET JSON from a Casework route, throwing `Error(body.error)` (or the status
 * text) when it is not 2xx. The desk's only way to read; writes stay server
 * actions.
 */
export async function getJson<T>(
  path: string,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    signal: init?.signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : response.statusText || `Request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

/** The open Desk's Runs, the Owner's Desks and the Spend. */
export function getDeskStatus(init?: { signal?: AbortSignal }) {
  return getJson<DeskStatusResponse>(apiPath.desk(), init);
}

/** Signed pages for up to 60 Documents. */
export function getDocumentPages(
  ids: string[],
  init?: { signal?: AbortSignal },
) {
  return getJson<DocumentPagesResponse>(apiPath.documentPages(ids), init);
}
