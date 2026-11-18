"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath } from "../domain/api";
import type { DocumentSource, PreviewPage } from "../domain/contract";
import { chunkOf } from "./marks";
import { maxAgeFor, reads } from "./read-cache";
import { friendly } from "./ui";

/**
 * Fetches pages `from`..`to` (one chunk) with their marks, or throws.
 * `peek` returns them at once when they are already in hand.
 */
export type PageLoader = ((
  from: number,
  to: number,
) => Promise<PreviewPage[]>) & {
  peek?: (from: number, to: number) => PreviewPage[] | undefined;
};

type Pages = { total: number; pages: PreviewPage[] };

/** A loader over the pages route, for a Document or a Run of it, through the page's read cache. */
export function serverLoader(
  source: DocumentSource,
  runId?: string | null,
  map: (page: PreviewPage) => PreviewPage = (page) => page,
): PageLoader {
  const maxAge = maxAgeFor(runId);
  const path = (from: number, to: number) =>
    apiPath.pages(source, runId, from, to);
  const loader: PageLoader = async (from, to) =>
    (await reads.get<Pages>(path(from, to), maxAge)).pages.map(map);
  loader.peek = (from, to) =>
    reads.peek<Pages>(path(from, to), maxAge)?.pages.map(map);
  return loader;
}

/** Starts fetching the first chunk of a Document (or a Run of it), so opening it shows text at once. */
export function prefetchFirstPages(
  source: DocumentSource,
  total: number,
  runId?: string | null,
) {
  if (total < 1) return;
  const { from, to } = chunkOf(1, total);
  void serverLoader(source, runId)(from, to).catch(() => undefined);
}

/**
 * The pages of one Document, fetched a chunk at a time as they come near the
 * screen and kept. Chunks already in the page's read cache (prefetched, or
 * seen before) show on the first paint. `version` changes whenever pages
 * land. Remount (a `key`) to switch Documents.
 */
export function usePages(loader: PageLoader, total: number) {
  const cache = useRef<Map<number, PreviewPage> | null>(null);
  if (cache.current === null) {
    cache.current = new Map();
    if (total >= 1) {
      const { from, to } = chunkOf(1, total);
      for (const item of loader.peek?.(from, to) ?? [])
        cache.current.set(item.page, item);
    }
  }
  const pending = useRef(new Set<number>());
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const ensure = useCallback(
    (page: number) => {
      const kept = cache.current;
      if (!kept || page < 1 || page > total) return Promise.resolve();
      const { from, to } = chunkOf(page, total);
      if (kept.has(from) || pending.current.has(from)) return Promise.resolve();
      const ready = loader.peek?.(from, to);
      if (ready) {
        for (const item of ready) kept.set(item.page, item);
        setVersion((value) => value + 1);
        return Promise.resolve();
      }
      pending.current.add(from);
      return loader(from, to)
        .then((pages) => {
          for (const item of pages) kept.set(item.page, item);
          if (alive.current) {
            setVersion((value) => value + 1);
            setError(null);
          }
        })
        .catch((caught: unknown) => {
          if (alive.current)
            setError(friendly(caught, "These pages could not load."));
        })
        .finally(() => pending.current.delete(from));
    },
    [loader, total],
  );

  const get = useCallback((page: number) => cache.current?.get(page), []);
  return {
    get,
    ensure,
    version,
    error,
    loaded: cache.current.size,
  };
}
