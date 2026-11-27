import "server-only";
import { sql } from "./db";
import { supabase } from "./supabase";

/** One Storage object a purge left behind. */
export type QueuedObject = { bucket: string; name: string };

export type DrainDeps = {
  /** The next objects under queued prefixes (`access.storage_purge_batch`). */
  next: () => Promise<QueuedObject[]>;
  /** Removes objects from one bucket through the Storage API. */
  remove: (bucket: string, names: string[]) => Promise<void>;
};

export type DrainResult = { removed: number; batches: number; done: boolean };

/** Bounds one cron run: at most this many batches of up to 500 objects. */
export const MAX_BATCHES = 10;

/**
 * Removes the files of purged Owners, batch by batch, until the queue is
 * empty or the run's budget is spent. Stops early when a batch removes
 * nothing new (Storage refusing, say), so a stuck object never loops a run;
 * the next run tries again.
 */
export async function drainStoragePurge(
  deps: DrainDeps,
  maxBatches = MAX_BATCHES,
): Promise<DrainResult> {
  let removed = 0;
  let previous = "";
  for (let batches = 0; batches < maxBatches; batches++) {
    const objects = await deps.next();
    if (objects.length === 0) return { removed, batches, done: true };
    const key = objects.map((o) => `${o.bucket}/${o.name}`).join("\n");
    if (key === previous) return { removed, batches, done: false };
    previous = key;
    const byBucket = new Map<string, string[]>();
    for (const object of objects) {
      byBucket.set(object.bucket, [
        ...(byBucket.get(object.bucket) ?? []),
        object.name,
      ]);
    }
    for (const [bucket, names] of byBucket) {
      await deps.remove(bucket, names);
      removed += names.length;
    }
  }
  return { removed, batches: maxBatches, done: false };
}

/** The real queue (direct Postgres) and Storage (supabase-js, service role). */
export const storagePurgeDeps: DrainDeps = {
  async next() {
    try {
      return await sql()<QueuedObject[]>`
        select bucket, name from access.storage_purge_batch(
          p_rows => 20, p_objects => 500
        )`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read the purge queue: ${message}`, {
        cause: error,
      });
    }
  },
  async remove(bucket, names) {
    const { error } = await supabase().storage.from(bucket).remove(names);
    if (error)
      throw new Error(
        `Could not remove files from ${bucket}: ${error.message}`,
      );
  },
};
