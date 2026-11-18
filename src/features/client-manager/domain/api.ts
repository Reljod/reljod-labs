import type {
  CatalogCard,
  ClientSummary,
  EdgeLite,
  NodeFull,
  SourceFull,
} from "../server/service";
import type { ThreadMessage, ThreadSummary } from "./chat";

/**
 * The Client Manager HTTP reads: where each lives and what it answers. The
 * browser calls them only through `components/api.ts`. Every route passes the
 * Access gate and reads only what the Owner may see (their own clients and
 * Threads, and the Samples). Errors are JSON `{ error: string }` with 400,
 * 401, 404, 429 or 500.
 */
export const API_ROOT = "/api/client-manager";

const id = (value: string) => encodeURIComponent(value);

export const apiPath = {
  catalog: () => `${API_ROOT}/clients`,
  client: (clientId: string) => `${API_ROOT}/clients/${id(clientId)}`,
  /** `root`, `branch:<id>`, `leaf:<id>` or `node:<key>`. */
  edges: (clientId: string, scope: string) =>
    `${API_ROOT}/clients/${id(clientId)}/edges?scope=${id(scope)}`,
  node: (clientId: string, key: string) =>
    `${API_ROOT}/clients/${id(clientId)}/node?key=${id(key)}`,
  source: (clientId: string, sourceId: string) =>
    `${API_ROOT}/clients/${id(clientId)}/sources/${id(sourceId)}`,
  threads: () => `${API_ROOT}/threads`,
  thread: (threadId: string) => `${API_ROOT}/threads/${id(threadId)}`,
  messages: (threadId: string) =>
    `${API_ROOT}/threads/${id(threadId)}/messages`,
};

export type CatalogResponse = { clients: CatalogCard[] };
export type ClientResponse = ClientSummary;
export type EdgesResponse = { edges: EdgeLite[] };
export type NodeResponse = NodeFull;
export type SourceResponse = SourceFull;
export type ThreadsResponse = { threads: ThreadSummary[] };
export type ThreadResponse = {
  thread: ThreadSummary;
  messages: ThreadMessage[];
};
