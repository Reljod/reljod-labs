"use client";

import type { BuildEvent } from "@/features/client-manager/domain/events";
import {
  ApiError,
  followNdjson,
  getJson,
  send,
  streamJson,
} from "@/platform/client/api";
import {
  type AdditionInput,
  type AdditionResponse,
  type AskInput,
  apiPath,
  type CatalogResponse,
  type ClientResponse,
  type DecisionInput,
  type EdgesResponse,
  type IntakeResponse,
  type McpTokenResponse,
  type NodeResponse,
  type SourceResponse,
  type ThreadPatch,
  type ThreadResponse,
  type ThreadsResponse,
} from "../domain/api";
import type { AssistantEvent, Proposal, ThreadSummary } from "../domain/chat";

/**
 * The browser's side of the Client Manager REST API: typed wrappers over
 * `@/platform/client/api`, and the React Query keys of the reads. Every
 * failure is an `ApiError` carrying the message the route chose to show.
 */

/** How long a read counts as fresh: a remount within it shows the cache and asks nothing. */
export const FRESH_MS = 30_000;

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

/** Whether a read failed because the thing is gone or isn't the Owner's. */
export const isGone = (error: unknown) =>
  error instanceof ApiError && error.status === 404;

type Signal = { signal?: AbortSignal };

// Reads -------------------------------------------------------------------------

export const fetchCatalog = async (init?: Signal) =>
  (await getJson<CatalogResponse>(apiPath.clients(), init)).clients;

export const fetchThreads = async (init?: Signal) =>
  (await getJson<ThreadsResponse>(apiPath.threads(), init)).threads;

export const fetchThread = (id: string, init?: Signal) =>
  getJson<ThreadResponse>(apiPath.thread(id), init);

export const fetchClient = (id: string, init?: Signal) =>
  getJson<ClientResponse>(apiPath.client(id), init);

export const fetchEdges = async (id: string, scope: string, init?: Signal) =>
  (
    await getJson<EdgesResponse>(apiPath.edges(id), {
      ...init,
      query: { scope },
    })
  ).edges;

export const fetchNode = (id: string, key: string, init?: Signal) =>
  getJson<NodeResponse>(apiPath.node(id), { ...init, query: { key } });

export const fetchSource = (id: string, sourceId: string, init?: Signal) =>
  getJson<SourceResponse>(apiPath.source(id, sourceId), init);

/** Retries a failed read twice, but never one that came back 404. */
const retryUnlessGone = (count: number, error: Error) =>
  !isGone(error) && count < 2;

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

/** A Build's events from the `from`th on; resolves when the stream ends. */
export const followBuild = (
  buildId: string,
  from: number,
  onEvent: (event: BuildEvent) => void,
  init?: Signal,
) =>
  followNdjson<BuildEvent>(apiPath.buildEvents(buildId), onEvent, {
    ...init,
    query: { from },
  });

// Writes ------------------------------------------------------------------------

export const createIntake = (input: {
  name: string;
  note: string;
  files: { name: string; type: string; size: number }[];
  portrait: { name: string; type: string; size: number } | null;
}) => send<IntakeResponse>("POST", apiPath.clients(), input);

export const deleteClient = (clientId: string) =>
  send("DELETE", apiPath.client(clientId));

export const createAddition = (clientId: string, input: AdditionInput) =>
  send<AdditionResponse>("POST", apiPath.builds(clientId), input);

export const startBuild = (buildId: string) =>
  send<{ started: true }>("POST", apiPath.startBuild(buildId));

export const stopBuild = (buildId: string) =>
  send<{ stopped: true }>("POST", apiPath.stopBuild(buildId));

export const createThread = (input: ThreadPatch) =>
  send<ThreadSummary>("POST", apiPath.threads(), input);

export const patchThread = (threadId: string, input: ThreadPatch) =>
  send("PATCH", apiPath.thread(threadId), input);

export const deleteThread = (threadId: string) =>
  send("DELETE", apiPath.thread(threadId));

/** Asks the Desk; each AssistantEvent of the answer goes to `onEvent`. */
export const ask = (
  threadId: string,
  input: AskInput,
  onEvent: (event: AssistantEvent) => void,
  init?: Signal,
) =>
  streamJson<AssistantEvent>(apiPath.messages(threadId), input, onEvent, init);

export const decideProposal = (
  threadId: string,
  messageId: string,
  input: DecisionInput,
) =>
  send<{ proposal: Proposal }>(
    "POST",
    apiPath.proposal(threadId, messageId),
    input,
  );

export const mintMcpToken = () =>
  send<McpTokenResponse>("POST", apiPath.mcpToken());
