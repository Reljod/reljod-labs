/**
 * A value worth keeping for a while: computed once, shared by every caller
 * until it is `ttlMs` old, and forgotten at once if computing it fails, so
 * the next caller tries again. For shared seed data only, never an Owner's.
 */
export function ttlValue<T>(
  ttlMs: number,
  compute: () => Promise<T>,
  now: () => number = Date.now,
) {
  let entry: { at: number; promise: Promise<T> } | undefined;
  return function get(): Promise<T> {
    if (entry && now() - entry.at < ttlMs) return entry.promise;
    const promise = compute();
    const mine = { at: now(), promise };
    entry = mine;
    promise.catch(() => {
      if (entry === mine) entry = undefined;
    });
    return promise;
  };
}

/**
 * Per-key values kept for `ttlMs`, filled in batches: `get` computes only the
 * keys that are missing or stale, in one call, and keeps what comes back.
 * Keys the batch does not return are not kept. Holds at most `maxEntries`.
 */
export function ttlMap<V>(
  ttlMs: number,
  computeMissing: (keys: string[]) => Promise<Map<string, V>>,
  options: { maxEntries?: number; now?: () => number } = {},
) {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 5000;
  const entries = new Map<string, { at: number; value: V }>();
  return async function get(keys: string[]): Promise<Map<string, V>> {
    const at = now();
    const found = new Map<string, V>();
    const missing: string[] = [];
    for (const key of new Set(keys)) {
      const entry = entries.get(key);
      if (entry && at - entry.at < ttlMs) found.set(key, entry.value);
      else missing.push(key);
    }
    if (missing.length === 0) return found;
    const fresh = await computeMissing(missing);
    for (const [key, value] of fresh) {
      found.set(key, value);
      entries.delete(key);
      entries.set(key, { at, value });
    }
    // Oldest first: a Map keeps insertion order.
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    return found;
  };
}
