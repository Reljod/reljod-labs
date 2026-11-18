import type { RunView } from "../domain/run";

/** How long a Run read ahead of time may stand in for a fresh read. */
export const PREFETCH_FRESH_MS = 10_000;

export type RunPrefetch = {
  /** Starts reading a Run the person is about to open (hover, focus). */
  prefetch: (runId: string) => void;
  /** Hands over a read already under way, such as the page's own. */
  seed: (runId: string, read: Promise<RunView | null>) => void;
  /** The read for `runId` if one is fresh; each read is handed out once. */
  take: (runId: string) => Promise<RunView | null> | undefined;
  /** Forgets `runId`, after the Run changed under it (a Redo). */
  drop: (runId: string) => void;
};

/**
 * Reads of Runs started before they are opened, so opening one shows it
 * without a wait. Each read is used once and only while fresh, so a Run that
 * moved on is read again; the event stream folds in the rest.
 */
export function runPrefetch(
  read: (runId: string) => Promise<RunView | null>,
  now: () => number = Date.now,
): RunPrefetch {
  const held = new Map<string, { at: number; read: Promise<RunView | null> }>();
  const fresh = (runId: string) => {
    const entry = held.get(runId);
    if (entry && now() - entry.at < PREFETCH_FRESH_MS) return entry;
    held.delete(runId);
    return undefined;
  };
  const seed = (runId: string, pending: Promise<RunView | null>) => {
    // A failed read is never handed out: opening reads again and says why.
    pending.catch(() => {
      if (held.get(runId)?.read === pending) held.delete(runId);
    });
    held.set(runId, { at: now(), read: pending });
  };
  return {
    prefetch(runId) {
      if (!fresh(runId)) seed(runId, read(runId));
    },
    seed,
    take(runId) {
      const entry = fresh(runId);
      held.delete(runId);
      return entry?.read;
    },
    drop(runId) {
      held.delete(runId);
    },
  };
}
