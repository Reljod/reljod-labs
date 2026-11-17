/**
 * A small seeded PRNG (mulberry32) so every Corpus Document is the same on
 * every machine and every run. Never Math.random, never the clock.
 */
export type Rng = {
  /** 0 <= n < 1 */
  next(): number;
  /** min <= n <= max, integers. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(items: T[]): T[];
  /** Picks a key by weight. */
  weighted<K extends string>(weights: Partial<Record<K, number>>): K;
};

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    },
    weighted(weights) {
      const entries = Object.entries(weights) as [string, number][];
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [key, w] of entries) {
        roll -= w;
        if (roll < 0) return key as never;
      }
      return entries[entries.length - 1][0] as never;
    },
  };
}

/** A stable 32-bit hash of a string, to derive sub-seeds. */
export function hashSeed(text: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
