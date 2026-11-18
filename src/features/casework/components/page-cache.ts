"use client";

import { useEffect, useState } from "react";
import { MAX_PAGE_IDS } from "../domain/api";
import type { DocumentPages } from "../view";
import { getDocumentPages } from "./api";

/** Signed URLs last an hour; refetch a little before they lapse. */
const FRESH_MS = 50 * 60 * 1000;
const RETRY_MS = 1500;
const DOCUMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * Fetches the pages of any Documents not already on hand, one request per
 * 60, and has the browser download the images so they show the moment
 * they're needed.
 * A failed fetch is forgotten, so the next ask tries again.
 */
export function preloadPages(documentIds: string[]) {
  const missing = [...new Set(documentIds)].filter(
    (id) => DOCUMENT_ID.test(id) && !fresh(id),
  );
  for (let start = 0; start < missing.length; start += MAX_PAGE_IDS)
    preloadBatch(missing.slice(start, start + MAX_PAGE_IDS));
}

function preloadBatch(missing: string[]) {
  // A GET, not a server action: Next sends actions one at a time, so pages
  // would wait behind any write the desk has in flight.
  const batch = getDocumentPages(missing).then((found) => {
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
