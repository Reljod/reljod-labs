import { QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  type FirstView,
  LIST_READS,
  type ListRead,
  TAB_READS,
} from "../domain/first-view";
import type { TabId } from "../domain/place";
import { api, keys } from "./api";

/**
 * How long a read stays fresh: a tab that mounts, or a prefetch on hover,
 * inside this window uses what is there instead of asking again. A write
 * still invalidates what it changed at once, and lists that move by
 * themselves (Runs at work, Sources being read, the Audit trail) keep their
 * own refresh intervals.
 */
export const FRESH_MS = 10_000;

/** What each list read answers. */
export type ListData = { [Read in ListRead]-?: NonNullable<FirstView[Read]> };

type ReadContext = { signal: AbortSignal };

const READS: {
  [Read in ListRead]: {
    key: (staffId: string) => QueryKey;
    read: (context: ReadContext) => Promise<ListData[Read]>;
  };
} = {
  // A Staff member's own Sessions: keyed by who is signed in.
  sessions: {
    key: (staffId) => [...keys.sessions, staffId],
    read: ({ signal }) => api.sessions.list({ signal }),
  },
  runs: {
    key: () => keys.runs(),
    read: ({ signal }) => api.runs.list({}, { signal }),
  },
  rules: {
    key: () => keys.rules(),
    read: ({ signal }) => api.rules.list({}, { signal }),
  },
  skills: {
    key: () => keys.skills,
    read: ({ signal }) => api.skills.list({ signal }),
  },
  sources: {
    key: () => keys.sources,
    read: ({ signal }) => api.sources.list({ signal }),
  },
  conflicts: {
    key: () => keys.conflicts(),
    read: ({ signal }) => api.knowledge.conflicts({}, { signal }),
  },
};

/**
 * The one definition of each list a tab reads when it mounts: its key and
 * how to read it (abortable, so a newer read or a write cancels it). The
 * tabs, the page's first view and the prefetch on hover all use these, so a
 * seeded or prefetched list is the one the tab asks for.
 */
export function listQuery<Read extends ListRead>(
  read: Read,
  staffId: string,
): {
  queryKey: QueryKey;
  queryFn: (context: ReadContext) => Promise<ListData[Read]>;
} {
  const spec = READS[read];
  return { queryKey: spec.key(staffId), queryFn: spec.read };
}

/** The cache entries a first view fills: each list under its tab's key, and the open Session's messages. */
export function firstViewEntries(
  view: FirstView,
  staffId: string,
): [QueryKey, unknown][] {
  const entries: [QueryKey, unknown][] = [];
  for (const read of LIST_READS) {
    const value = view[read];
    if (value !== undefined)
      entries.push([listQuery(read, staffId).queryKey, value]);
  }
  if (view.messages) {
    entries.push([
      keys.messages(view.messages.sessionId),
      view.messages.messages,
    ]);
  }
  return entries;
}

/**
 * The Harness's query client, holding the page's first view before anything
 * renders, so the tabs paint it on their first render and do not ask again
 * on mount.
 */
export function createHarnessQueryClient(
  view: FirstView,
  staffId: string,
): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, staleTime: FRESH_MS },
    },
  });
  for (const [key, data] of firstViewEntries(view, staffId)) {
    client.setQueryData(key, data);
  }
  return client;
}

/**
 * Reads ahead what a tab shows first, on intent (a pointer resting on its
 * tab, a focus). A list still fresh is not asked again.
 */
export function prefetchTabData(
  client: QueryClient,
  tab: TabId,
  staffId: string,
): void {
  for (const read of TAB_READS[tab]) {
    void client.prefetchQuery(listQuery(read, staffId));
  }
}
