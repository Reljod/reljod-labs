"use client";

import type { ThreadMessage, ThreadSummary } from "../domain/chat";
import type {
  CatalogCard,
  ClientSummary,
  EdgeLite,
  NodeFull,
  SourceFull,
} from "../server/service";

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

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) throw new Error("not-found");
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Could not load that.");
  }
  return response.json() as Promise<T>;
}

export const fetchCatalog = async () =>
  (await json<{ clients: CatalogCard[] }>("/api/client-manager/clients"))
    .clients;

export const fetchThreads = async () =>
  (await json<{ threads: ThreadSummary[] }>("/api/client-manager/threads"))
    .threads;

export const fetchThread = (id: string) =>
  json<{ thread: ThreadSummary; messages: ThreadMessage[] }>(
    `/api/client-manager/threads/${id}`,
  );

export const fetchClient = (id: string) =>
  json<ClientSummary>(`/api/client-manager/clients/${id}`);

export const fetchEdges = async (id: string, scope: string) =>
  (
    await json<{ edges: EdgeLite[] }>(
      `/api/client-manager/clients/${id}/edges?scope=${encodeURIComponent(scope)}`,
    )
  ).edges;

export const fetchNode = (id: string, key: string) =>
  json<NodeFull>(
    `/api/client-manager/clients/${id}/node?key=${encodeURIComponent(key)}`,
  );

export const fetchSource = (id: string, sourceId: string) =>
  json<SourceFull>(`/api/client-manager/clients/${id}/sources/${sourceId}`);

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
