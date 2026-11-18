import { describe, expect, it, vi } from "vitest";
import type { RunView } from "../domain/run";
import {
  FINISHED_FRESH_MS,
  FINISHED_KEPT,
  PREFETCH_FRESH_MS,
  runPrefetch,
} from "./run-prefetch";

const RUN = { id: "a", status: "running" } as RunView;
const done = (id: string) => ({ id, status: "completed" }) as RunView;

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

  it("keeps a finished Run: reopened at once, without a read", async () => {
    const { cache, read, tick } = setup();
    cache.remember(done("b"));
    tick(PREFETCH_FRESH_MS * 10);
    cache.prefetch("b");
    expect(read).not.toHaveBeenCalled();
    await expect(cache.take("b")).resolves.toEqual(done("b"));
    await expect(cache.take("b")).resolves.toEqual(done("b"));
  });

  it("keeps a Run read ahead once it turns out finished", async () => {
    const { cache } = setup();
    cache.seed("c", Promise.resolve(done("c")));
    await cache.take("c");
    await Promise.resolve();
    await expect(cache.take("c")).resolves.toEqual(done("c"));
  });

  it("does not keep a Run still going", () => {
    const { cache } = setup();
    cache.remember(RUN);
    expect(cache.take("a")).toBeUndefined();
  });

  it("forgets a finished Run on a Redo", () => {
    const { cache } = setup();
    cache.remember(done("b"));
    cache.drop("b");
    expect(cache.take("b")).toBeUndefined();
  });

  it("keeps only the newest finished Runs", () => {
    const { cache } = setup();
    for (let index = 0; index <= FINISHED_KEPT; index += 1) {
      cache.remember(done(`r${index}`));
    }
    expect(cache.take("r0")).toBeUndefined();
    expect(cache.take(`r${FINISHED_KEPT}`)).toBeDefined();
  });

  it("reads a kept Run again once its Recording link may have run out", () => {
    const { cache, tick } = setup();
    cache.remember(done("b"));
    tick(FINISHED_FRESH_MS);
    expect(cache.take("b")).toBeUndefined();
  });
});
