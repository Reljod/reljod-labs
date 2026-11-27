import "server-only";
import { unstable_rethrow } from "next/navigation";
import { requireOwner } from "@/features/access/server/gate";
import { currentRequest } from "@/platform/request/current";
import type {
  CatalogResponse,
  ClientResponse,
  ThreadResponse,
  ThreadsResponse,
} from "../domain/api";
import { clientManager } from "./container";

export type FirstLoad = {
  initialCatalog: CatalogResponse["clients"] | null;
  initialThreads: ThreadsResponse["threads"] | null;
  initialClient: ClientResponse | null;
  initialThread: ThreadResponse | null;
};

const NOTHING: FirstLoad = {
  initialCatalog: null,
  initialThreads: null,
  initialClient: null,
  initialThread: null,
};

/**
 * What the first screen shows, read while the page renders so it arrives
 * with the page: the same services, gate and Owner scoping as the routes,
 * the gate called once, every read in parallel. Nothing here throws: a read
 * that fails or is refused is null, and the browser asks the route instead,
 * which answers with the reason.
 */
export async function firstLoad(open: {
  clientId: string | null;
  threadId: string | null;
}): Promise<FirstLoad> {
  const [gate, request] = await Promise.all([
    requireOwner().catch(quietly),
    currentRequest(),
  ]);
  if (!gate) return NOTHING;
  const { owner } = gate;
  const caller = { owner, visitor: request.visitor };
  const services = clientManager(request.mode);
  const quiet = <T>(promise: Promise<T>) => promise.catch(quietly);
  const [initialCatalog, initialThreads, initialClient, initialThread] =
    await Promise.all([
      quiet(services.clients.catalog(owner)),
      quiet(services.threads.list(owner)),
      open.clientId
        ? quiet(services.clients.file(caller, open.clientId))
        : null,
      open.threadId ? quiet(services.threads.get(owner, open.threadId)) : null,
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
