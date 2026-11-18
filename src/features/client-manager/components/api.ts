"use client";

import {
  apiPath,
  type CatalogResponse,
  type ClientResponse,
  type EdgesResponse,
  type NodeResponse,
  type SourceResponse,
  type ThreadResponse,
  type ThreadsResponse,
} from "../domain/api";

/** How long a read counts as fresh: a remount within it shows the cache and asks nothing. */
export const FRESH_MS = 30_000;

/** The browser's reads of the Client Manager API, keyed for React Query. */

export const keys = {
  catalog: ["client-manager", "catalog"] as const,
  threads: ["client-manager", "threads"] as const,
  thread: (id: string) => ["client-manager", "thread", id] as const,
  client: (id: string) => ["client-manager", "client", id] as const,
  edges: (id: string, scope: string) =>
    ["client-manager", "edges", id, scope] as const,
  node: (id: string, key: string) =>
    ["client-manager", "node", id, key] as const,
  source: (id: string, sourceId: string) =>
    ["client-manager", "source", id, sourceId] as const,
};

/**
 * One read. Throws `Error("not-found")` on a 404 (the views say "gone" for
 * it) and `Error(body.error ?? status text)` on any other failure. The HTTP
 * cache is left on: Owner data comes back `no-store`, Sample data may be kept.
 */
export async function getJson<T>(
  path: string,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(path, { signal: init?.signal });
  if (response.status === 404) throw new Error("not-found");
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ?? (response.statusText || "Could not load that."),
    );
  }
  return response.json() as Promise<T>;
}

type Signal = { signal?: AbortSignal };

export const fetchCatalog = async (init?: Signal) =>
  (await getJson<CatalogResponse>(apiPath.catalog(), init)).clients;

export const fetchThreads = async (init?: Signal) =>
  (await getJson<ThreadsResponse>(apiPath.threads(), init)).threads;

export const fetchThread = (id: string, init?: Signal) =>
  getJson<ThreadResponse>(apiPath.thread(id), init);

export const fetchClient = (id: string, init?: Signal) =>
  getJson<ClientResponse>(apiPath.client(id), init);

export const fetchEdges = async (id: string, scope: string, init?: Signal) =>
  (await getJson<EdgesResponse>(apiPath.edges(id, scope), init)).edges;

export const fetchNode = (id: string, key: string, init?: Signal) =>
  getJson<NodeResponse>(apiPath.node(id, key), init);

export const fetchSource = (id: string, sourceId: string, init?: Signal) =>
  getJson<SourceResponse>(apiPath.source(id, sourceId), init);

/** Retries a failed read twice, but never one that came back 404. */
const retryUnlessGone = (count: number, error: Error) =>
  error.message !== "not-found" && count < 2;

/** A client's file: shared by its view and the Catalog's prefetch on hover. */
export const clientQuery = (id: string) => ({
  queryKey: keys.client(id),
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchClient(id, { signal }),
  staleTime: FRESH_MS,
  retry: retryUnlessGone,
});

/** A Thread: shared by the Desk and the Thread list's prefetch on hover. */
export const threadQuery = (id: string) => ({
  queryKey: keys.thread(id),
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchThread(id, { signal }),
  staleTime: FRESH_MS,
  retry: retryUnlessGone,
});

export async function send<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok)
    throw new Error(data?.error ?? "That didn't work. Try again.");
  return data as T;
}
