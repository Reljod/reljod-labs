"use client";

import { useEffect, useState } from "react";
import { type DocumentPages, documentsPages } from "../server/actions";

/** Signed URLs last an hour; refetch a little before they lapse. */
const FRESH_MS = 50 * 60 * 1000;
const RETRY_MS = 1500;

type Entry = {
  at: number;
  promise: Promise<DocumentPages | null>;
  value?: DocumentPages | null;
};

const cache = new Map<string, Entry>();

function fresh(id: string) {
  const entry = cache.get(id);
  if (entry && Date.now() - entry.at < FRESH_MS) return entry;
  cache.delete(id);
  return undefined;
}

/**
 * Fetches the pages of any Documents not already on hand, in one call, and
 * has the browser download the images so they show the moment they're needed.
 * A failed fetch is forgotten, so the next ask tries again.
 */
export function preloadPages(documentIds: string[]) {
  const missing = [...new Set(documentIds)].filter((id) => !fresh(id));
  if (missing.length === 0) return;
  const batch = documentsPages(missing).then((found) => {
    for (const pages of Object.values(found))
      for (const src of pages.pages) if (src) new Image().src = src;
    return found;
  });
  for (const id of missing) {
    const entry: Entry = {
      at: Date.now(),
      promise: batch.then(
        (found) => {
          const value = found[id] ?? null;
          entry.value = value;
          if (!value) cache.delete(id);
          return value;
        },
        (error: unknown) => {
          cache.delete(id);
          throw error;
        },
      ),
    };
    cache.set(id, entry);
  }
}

/** One Document's pages: at once if preloaded, otherwise fetched (and retried) here. */
export function usePages(documentId: string | null) {
  const [loaded, setLoaded] = useState<{
    id: string;
    pages: DocumentPages | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new attempt retries a failed fetch
  useEffect(() => {
    if (!documentId) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    preloadPages([documentId]);
    fresh(documentId)?.promise.then(
      (pages) => live && setLoaded({ id: documentId, pages }),
      () => {
        if (live) retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      },
    );
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [documentId, attempt]);
  if (!documentId) return null;
  if (loaded?.id === documentId) return loaded.pages;
  return fresh(documentId)?.value ?? null;
}
