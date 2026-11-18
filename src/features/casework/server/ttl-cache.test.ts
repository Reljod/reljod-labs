import { describe, expect, it, vi } from "vitest";
import { ttlMap, ttlValue } from "./ttl-cache";

describe("ttlValue", () => {
  it("computes once while fresh, again once stale", async () => {
    let clock = 0;
    const compute = vi.fn(async () => clock);
    const get = ttlValue(100, compute, () => clock);
    expect(await get()).toBe(0);
    clock = 99;
    expect(await get()).toBe(0);
    expect(compute).toHaveBeenCalledTimes(1);
    clock = 100;
    expect(await get()).toBe(100);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight computation", async () => {
    const compute = vi.fn(async () => "x");
    const get = ttlValue(1000, compute);
    await Promise.all([get(), get(), get()]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("forgets a failure so the next call retries", async () => {
    const compute = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("up");
    const get = ttlValue(1000, compute);
    await expect(get()).rejects.toThrow("down");
    expect(await get()).toBe("up");
  });
});

describe("ttlMap", () => {
  it("computes only the missing or stale keys", async () => {
    let clock = 0;
    const compute = vi.fn(
      async (keys: string[]) =>
        new Map(keys.map((key) => [key, `${key}@${clock}`])),
    );
    const get = ttlMap(100, compute, { now: () => clock });
    expect(await get(["a", "b", "a"])).toEqual(
      new Map([
        ["a", "a@0"],
        ["b", "b@0"],
      ]),
    );
    expect(compute).toHaveBeenLastCalledWith(["a", "b"]);
    clock = 50;
    expect((await get(["a", "c"])).get("a")).toBe("a@0");
    expect(compute).toHaveBeenLastCalledWith(["c"]);
    clock = 120;
    expect((await get(["a", "c"])).get("a")).toBe("a@120");
    expect(compute).toHaveBeenLastCalledWith(["a"]);
  });

  it("does not keep keys the batch left out", async () => {
    const compute = vi.fn(async () => new Map<string, string>());
    const get = ttlMap(1000, compute);
    expect((await get(["gone"])).size).toBe(0);
    await get(["gone"]);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("drops the oldest entries past its cap", async () => {
    const compute = vi.fn(
      async (keys: string[]) => new Map(keys.map((key) => [key, key])),
    );
    const get = ttlMap(1000, compute, { maxEntries: 2 });
    await get(["a"]);
    await get(["b"]);
    await get(["c"]);
    await get(["a"]);
    expect(compute).toHaveBeenLastCalledWith(["a"]);
    await get(["c"]);
    expect(compute).toHaveBeenCalledTimes(4);
  });
});
