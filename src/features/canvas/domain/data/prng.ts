/**
 * A small seeded PRNG (mulberry32) so the open data of Meridia is the same on
 * every machine and every run. Never Math.random, never the clock.
 */
export type Rng = {
  /** 0 <= n < 1 */
  next(): number;
  /** min <= n <= max, integers. */
  int(min: number, max: number): number;
  /** min <= n < max. */
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  /** Standard normal (Box-Muller). */
  normal(): number;
  /** Poisson with mean `lambda` (Knuth, fine for small means). */
  poisson(lambda: number): number;
  /** Picks an index by weight. */
  weightedIndex(weights: readonly number[]): number;
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
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    const u = Math.max(next(), 1e-12);
    const v = next();
    const radius = Math.sqrt(-2 * Math.log(u));
    spare = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    normal,
    poisson(lambda) {
      if (lambda <= 0) return 0;
      if (lambda > 30) {
        return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()));
      }
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = next();
      while (p > limit) {
        k++;
        p *= next();
      }
      return k;
    },
    weightedIndex(weights) {
      let total = 0;
      for (const w of weights) total += w;
      let roll = next() * total;
      for (let i = 0; i < weights.length; i++) {
        roll -= weights[i];
        if (roll < 0) return i;
      }
      return weights.length - 1;
    },
  };
}

/** A stable 32-bit hash of a string (FNV-1a), to derive sub-seeds. */
export function hashSeed(text: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The root seed of every Meridia table; bump DATA_VERSION if it changes. */
export const ROOT_SEED = 20250101;

/** The Rng of one table or shared intermediate, derived from its name only. */
export function rngFor(name: string): Rng {
  return createRng(hashSeed(name, ROOT_SEED));
}

/** Rounds to `digits` decimals. */
export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
