import "server-only";
import { unstable_rethrow } from "next/navigation";
import type {
  CatalogResponse,
  ClientResponse,
  ThreadResponse,
  ThreadsResponse,
} from "../domain/api";
import { catalog, clientSummary, viewableClient } from "./service";
import { currentOwner, visitor } from "./session";
import { messagesOf, ownedThread, summaryOf, threadsOf } from "./threads";

export type FirstLoad = {
  initialCatalog: CatalogResponse["clients"] | null;
  initialThreads: ThreadsResponse["threads"] | null;
  initialClient: ClientResponse | null;
  initialThread: ThreadResponse | null;
};

/**
 * What the first screen shows, read while the page renders so it arrives
 * with the page: no browser round trip after hydration. The same gate and
 * Owner scoping as the routes (every read waits for `currentOwner()`), all in
 * parallel. Nothing here throws: a read that fails or finds nothing is null,
 * and the browser asks the route instead, which answers with the error.
 */
export async function firstLoad(open: {
  clientId: string | null;
  threadId: string | null;
}): Promise<FirstLoad> {
  const owner = await currentOwner().catch(quietly);
  if (!owner) {
    return {
      initialCatalog: null,
      initialThreads: null,
      initialClient: null,
      initialThread: null,
    };
  }
  const quiet = <T>(promise: Promise<T | null>) => promise.catch(quietly);
  const [initialCatalog, initialThreads, initialClient, initialThread] =
    await Promise.all([
      quiet(catalog(owner)),
      quiet(threadsOf(owner)),
      open.clientId ? quiet(clientOf(open.clientId, owner)) : null,
      open.threadId ? quiet(threadOf(open.threadId, owner)) : null,
    ]);
  return { initialCatalog, initialThreads, initialClient, initialThread };
}

/**
 * A failed read becomes null, but Next's own signals (the prerender bail-out
 * when a request read happens at build time) go through, or the page would
 * be prerendered with no data.
 */
function quietly(error: unknown): null {
  unstable_rethrow(error);
  return null;
}

async function clientOf(
  clientId: string,
  owner: Awaited<ReturnType<typeof currentOwner>>,
) {
  const client = await viewableClient(clientId, owner);
  return client ? clientSummary(client, owner, await visitor()) : null;
}

async function threadOf(
  threadId: string,
  owner: Awaited<ReturnType<typeof currentOwner>>,
) {
  const thread = await ownedThread(threadId, owner);
  return thread
    ? { thread: summaryOf(thread), messages: await messagesOf(thread) }
    : null;
}
