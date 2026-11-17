"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentSource, PreviewPage } from "../domain/contract";
import { previewPages } from "../server/actions";
import { chunkOf } from "./marks";
import { friendly } from "./ui";

/** Fetches pages `from`..`to` (one chunk) with their marks, or throws. */
export type PageLoader = (from: number, to: number) => Promise<PreviewPage[]>;

/** A loader over the `previewPages` action, for a Document or a Run of it. */
export function serverLoader(
  source: DocumentSource,
  runId?: string | null,
  map: (page: PreviewPage) => PreviewPage = (page) => page,
): PageLoader {
  return async (from, to) => {
    const result = await previewPages({
      source,
      ...(runId ? { runId } : {}),
      from,
      to,
    });
    if ("error" in result) throw new Error(result.error);
    return result.pages.map(map);
  };
}

/**
 * The pages of one Document, fetched a chunk at a time as they come near the
 * screen and kept. `version` changes whenever pages land. Remount (a `key`)
 * to switch Documents.
 */
export function usePages(loader: PageLoader, total: number) {
  const cache = useRef(new Map<number, PreviewPage>());
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
      if (page < 1 || page > total) return Promise.resolve();
      const { from, to } = chunkOf(page, total);
      if (cache.current.has(from) || pending.current.has(from))
        return Promise.resolve();
      pending.current.add(from);
      return loader(from, to)
        .then((pages) => {
          for (const item of pages) cache.current.set(item.page, item);
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

  const get = useCallback((page: number) => cache.current.get(page), []);
  return { get, ensure, version, error, loaded: cache.current.size };
}
