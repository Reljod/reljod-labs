import { describe, expect, it, vi } from "vitest";
import type { RunView } from "../domain/run";
import { PREFETCH_FRESH_MS, runPrefetch } from "./run-prefetch";

const RUN = { id: "a" } as RunView;

function setup() {
  let clock = 0;
  const read = vi.fn(async (_id: string) => RUN);
  const cache = runPrefetch(read, () => clock);
  return { cache, read, tick: (ms: number) => (clock += ms) };
}

describe("runPrefetch", () => {
  it("hands a prefetched read out once", async () => {
    const { cache, read } = setup();
    cache.prefetch("a");
    expect(read).toHaveBeenCalledTimes(1);
    await expect(cache.take("a")).resolves.toBe(RUN);
    expect(cache.take("a")).toBeUndefined();
  });

  it("does not read twice while a read is fresh", () => {
    const { cache, read, tick } = setup();
    cache.prefetch("a");
    tick(PREFETCH_FRESH_MS - 1);
    cache.prefetch("a");
    expect(read).toHaveBeenCalledTimes(1);
    tick(1);
    cache.prefetch("a");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not hand out a stale read", () => {
    const { cache, tick } = setup();
    cache.prefetch("a");
    tick(PREFETCH_FRESH_MS);
    expect(cache.take("a")).toBeUndefined();
  });

  it("forgets a dropped Run", () => {
    const { cache } = setup();
    cache.seed("a", Promise.resolve(RUN));
    cache.drop("a");
    expect(cache.take("a")).toBeUndefined();
  });

  it("forgets a read that failed", async () => {
    const { cache } = setup();
    const failed = Promise.reject(new Error("down"));
    cache.seed("a", failed);
    await failed.catch(() => {});
    await Promise.resolve();
    expect(cache.take("a")).toBeUndefined();
  });
});
