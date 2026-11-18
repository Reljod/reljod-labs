/**
 * The page's small cache of reads that need not be fetched twice: a finished
 * Run's comparison and pages never change, so they are kept for the visit;
 * a preview before any Run follows the Owner's current Rulebook, so it is
 * kept a few minutes and dropped when the Rulebook is saved. It lives in
 * memory only (the routes answer `private, no-store`), and Sieve clears it
 * when it unmounts.
 */
import { API_ROOT } from "../domain/api";
import { getJson } from "./api";

/** A preview before any Run is kept this long (it follows the Owner's Rulebook). */
export const PREVIEW_MAX_AGE_MS = 5 * 60_000;

/** True for a preview path that depends on the Owner's current Rulebook. */
export const isRulebookPreview = (path: string) =>
  path.startsWith(`${API_ROOT}/preview/`) && !/[?&]run=/.test(path);

type Entry = {
  at: number;
  value: Promise<unknown>;
  /** The value once it has landed, for a first paint without a skeleton. */
  data?: unknown;
  done: boolean;
};

/**
 * An in-memory cache of reads by path: one request per path at a time,
 * failures forgotten, the oldest dropped past `size`.
 */
export function readCache(
  fetcher: (path: string) => Promise<unknown> = (path) => getJson(path),
  now: () => number = Date.now,
  size = 120,
) {
  const entries = new Map<string, Entry>();
  const fresh = (entry: Entry | undefined, maxAgeMs: number) =>
    entry !== undefined && now() - entry.at < maxAgeMs;

  return {
    /** The cached read of `path` if it is younger than `maxAgeMs`, else a new one. */
    get<T>(path: string, maxAgeMs = Number.POSITIVE_INFINITY): Promise<T> {
      const hit = entries.get(path);
      if (hit && fresh(hit, maxAgeMs)) {
        entries.delete(path);
        entries.set(path, hit);
        return hit.value as Promise<T>;
      }
      const entry: Entry = { at: now(), value: fetcher(path), done: false };
      entry.value.then(
        (data) => {
          entry.data = data;
          entry.done = true;
        },
        () => {
          if (entries.get(path) === entry) entries.delete(path);
        },
      );
      entries.set(path, entry);
      while (entries.size > size) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return entry.value as Promise<T>;
    },
    /** What `get` would resolve to, if it has already landed and is fresh. */
    peek<T>(path: string, maxAgeMs = Number.POSITIVE_INFINITY): T | undefined {
      const hit = entries.get(path);
      return hit?.done && fresh(hit, maxAgeMs) ? (hit.data as T) : undefined;
    },
    /** Drops every entry whose path matches. */
    forget(match: (path: string) => boolean) {
      for (const path of [...entries.keys()])
        if (match(path)) entries.delete(path);
    },
    clear() {
      entries.clear();
    },
  };
}

/** The page's cache. Sieve clears it when it unmounts, so it never outlives the visit. */
export const reads = readCache();

/** How long a read of this preview may be kept. */
export const maxAgeFor = (runId: string | null | undefined) =>
  runId ? Number.POSITIVE_INFINITY : PREVIEW_MAX_AGE_MS;
