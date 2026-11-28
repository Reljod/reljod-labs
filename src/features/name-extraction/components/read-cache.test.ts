import { describe, expect, it, vi } from "vitest";
import { apiPath } from "../domain/api";
import { isRulebookPreview, readCache } from "./read-cache";

const corpus = { kind: "corpus", corpusId: "ne-te-01" } as const;
const upload = {
  kind: "upload",
  uploadId: "22222222-2222-4222-8222-222222222222",
} as const;

describe("paths", () => {
  it("tells a Rulebook-dependent preview from a Run's, so a save drops only those", () => {
    expect(isRulebookPreview(apiPath.pages(upload, null, 1, 12))).toBe(true);
    expect(isRulebookPreview(apiPath.pages(corpus, null, 1, 12))).toBe(true);
    expect(isRulebookPreview(apiPath.overview(corpus))).toBe(true);
    expect(isRulebookPreview(apiPath.pages(corpus, "r1", 1, 12))).toBe(false);
    expect(isRulebookPreview(apiPath.comparison("r1"))).toBe(false);
  });
});

describe("readCache", () => {
  it("asks once per path while the answer is fresh", async () => {
    const fetcher = vi.fn(async (path: string) => `got ${path}`);
    let clock = 0;
    const cache = readCache(fetcher, () => clock);
    await expect(cache.get("/a", 100)).resolves.toBe("got /a");
    await cache.get("/a", 100);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.peek("/a", 100)).toBe("got /a");
    clock = 100;
    expect(cache.peek("/a", 100)).toBeUndefined();
    await cache.get("/a", 100);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shares one request between callers before it lands", async () => {
    const fetcher = vi.fn(async () => 1);
    const cache = readCache(fetcher);
    const [a, b] = [cache.get("/a"), cache.get("/a")];
    expect(cache.peek("/a")).toBeUndefined();
    expect(await a).toBe(await b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("forgets a failure, so the next read asks again", async () => {
    const fetcher = vi
      .fn<(path: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("up");
    const cache = readCache(fetcher);
    await expect(cache.get("/a")).rejects.toThrow("down");
    await expect(cache.get("/a")).resolves.toBe("up");
  });

  it("drops the least recently used past its size", async () => {
    const fetcher = vi.fn(async (path: string) => path);
    const cache = readCache(fetcher, Date.now, 2);
    await cache.get("/a");
    await cache.get("/b");
    await cache.get("/a");
    await cache.get("/c");
    expect(cache.peek("/a")).toBe("/a");
    expect(cache.peek("/b")).toBeUndefined();
  });

  it("forgets by match and clears", async () => {
    const cache = readCache(async (path) => path);
    await cache.get("/keep");
    await cache.get("/drop");
    cache.forget((path) => path === "/drop");
    expect(cache.peek("/drop")).toBeUndefined();
    expect(cache.peek("/keep")).toBe("/keep");
    cache.clear();
    expect(cache.peek("/keep")).toBeUndefined();
  });
});
