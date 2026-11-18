import { describe, expect, it, vi } from "vitest";
import { SEED_URL_TTL_SECONDS, seedUrlCache } from "./seed-urls";

const signer = () => {
  let round = 0;
  return vi.fn(async (paths: string[]) => {
    round += 1;
    return new Map(paths.map((path) => [path, `${path}?v=${round}`]));
  });
};

describe("seedUrlCache", () => {
  it("signs for two hours and hands the same link back within the first hour", async () => {
    let time = 0;
    const sign = signer();
    const urls = seedUrlCache(sign, () => time);
    const first = await urls(["a.png"]);
    expect(sign).toHaveBeenCalledWith(["a.png"], SEED_URL_TTL_SECONDS);
    time = 59 * 60 * 1000;
    expect(await urls(["a.png"])).toEqual(first);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("signs again once less than an hour is left", async () => {
    let time = 0;
    const sign = signer();
    const urls = seedUrlCache(sign, () => time);
    await urls(["a.png"]);
    time = 61 * 60 * 1000;
    expect((await urls(["a.png"])).get("a.png")).toBe("a.png?v=2");
  });

  it("signs only what it does not hold", async () => {
    const sign = signer();
    const urls = seedUrlCache(sign, () => 0);
    await urls(["a.png"]);
    await urls(["a.png", "b.png", ""]);
    expect(sign).toHaveBeenLastCalledWith(["b.png"], SEED_URL_TTL_SECONDS);
  });

  it("keeps nothing when signing fails", async () => {
    const sign = vi.fn(async () => new Map<string, string>());
    const urls = seedUrlCache(sign, () => 0);
    expect((await urls(["a.png"])).size).toBe(0);
    await urls(["a.png"]);
    expect(sign).toHaveBeenCalledTimes(2);
  });
});
