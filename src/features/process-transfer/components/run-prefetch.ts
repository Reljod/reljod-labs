import { isOver, type RunView } from "../domain/run";

/** How long a Run read ahead of time may stand in for a fresh read. */
export const PREFETCH_FRESH_MS = 10_000;
/** Finished Runs kept to reopen without a request. */
export const FINISHED_KEPT = 20;
/** A kept Run's signed Recording link lasts an hour (`signedUrl`); read again well before. */
export const FINISHED_FRESH_MS = 45 * 60_000;

export type RunPrefetch = {
  /** Starts reading a Run the person is about to open (hover, focus). */
  prefetch: (runId: string) => void;
  /** Hands over a read already under way, such as the page's own. */
  seed: (runId: string, read: Promise<RunView | null>) => void;
  /** The read for `runId` if one is fresh; each read is handed out once. */
  take: (runId: string) => Promise<RunView | null> | undefined;
  /** Keeps a finished Run, which never changes, to reopen at once. */
  remember: (run: RunView | null) => void;
  /** Forgets `runId`, after the Run changed under it (a Redo). */
  drop: (runId: string) => void;
};

/**
 * Reads of Runs started before they are opened, so opening one shows it
 * without a wait. Each read is used once and only while fresh, so a Run that
 * moved on is read again; the event stream folds in the rest. A finished Run
 * does not move on: it is kept (the newest `FINISHED_KEPT`, while its
 * Recording link is good) until a Redo starts it again. Lives as long as the page, never in a module, so nothing
 * outlives the visit or its Owner.
 */
export function runPrefetch(
  read: (runId: string) => Promise<RunView | null>,
  now: () => number = Date.now,
): RunPrefetch {
  const finished = new Map<string, { at: number; run: RunView }>();
  const kept = (runId: string) => {
    const entry = finished.get(runId);
    if (entry && now() - entry.at < FINISHED_FRESH_MS) return entry.run;
    finished.delete(runId);
    return undefined;
  };
  const remember = (run: RunView | null) => {
    if (!run || !isOver(run.status)) return;
    finished.delete(run.id);
    finished.set(run.id, { at: now(), run });
    for (const oldest of finished.keys()) {
      if (finished.size <= FINISHED_KEPT) break;
      finished.delete(oldest);
    }
  };
  const held = new Map<string, { at: number; read: Promise<RunView | null> }>();
  const fresh = (runId: string) => {
    const entry = held.get(runId);
    if (entry && now() - entry.at < PREFETCH_FRESH_MS) return entry;
    held.delete(runId);
    return undefined;
  };
  const seed = (runId: string, pending: Promise<RunView | null>) => {
    // A failed read is never handed out: opening reads again and says why.
    pending.then(remember, () => {
      if (held.get(runId)?.read === pending) held.delete(runId);
    });
    held.set(runId, { at: now(), read: pending });
  };
  return {
    prefetch(runId) {
      if (!kept(runId) && !fresh(runId)) seed(runId, read(runId));
    },
    seed,
    take(runId) {
      const done = kept(runId);
      if (done) return Promise.resolve(done);
      const entry = fresh(runId);
      held.delete(runId);
      return entry?.read;
    },
    remember,
    drop(runId) {
      held.delete(runId);
      finished.delete(runId);
    },
  };
}
