import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ supabase: vi.fn() }));

const { drainStoragePurge } = await import("./storage-purge");

type Obj = { bucket: string; name: string };

/** A fake queue over a fake Storage: `next` lists what is still stored. */
function fakeStorage(objects: Obj[], { stuck = false, size = 2 } = {}) {
  let stored = [...objects];
  const removed: Obj[] = [];
  return {
    removed,
    deps: {
      next: async () => stored.slice(0, size),
      remove: async (bucket: string, names: string[]) => {
        if (stuck) return;
        for (const name of names) removed.push({ bucket, name });
        stored = stored.filter(
          (o) => !(o.bucket === bucket && names.includes(o.name)),
        );
      },
    },
  };
}

describe("drainStoragePurge", () => {
  it("removes every queued object, grouped by bucket, until the queue is empty", async () => {
    const objects = [
      { bucket: "loupe", name: "u/a/1.png" },
      { bucket: "casework", name: "uploads/d/1.pdf" },
      { bucket: "loupe", name: "x/a/e/pages/1.png" },
    ];
    const { deps, removed } = fakeStorage(objects);
    const result = await drainStoragePurge(deps);
    expect(result).toEqual({ removed: 3, batches: 2, done: true });
    expect(removed).toEqual(expect.arrayContaining(objects));
  });

  it("stops within its budget and says it is not done", async () => {
    const objects = Array.from({ length: 10 }, (_, n) => ({
      bucket: "harness",
      name: `owners/guest-x/${n}`,
    }));
    const { deps } = fakeStorage(objects);
    expect(await drainStoragePurge(deps, 3)).toEqual({
      removed: 6,
      batches: 3,
      done: false,
    });
  });

  it("stops when Storage keeps the same objects, instead of looping", async () => {
    const { deps } = fakeStorage(
      [{ bucket: "operator", name: "frames/r/0.png" }],
      {
        stuck: true,
      },
    );
    const next = vi.spyOn(deps, "next");
    const result = await drainStoragePurge(deps, 10);
    expect(result.done).toBe(false);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("lets a Storage failure surface", async () => {
    await expect(
      drainStoragePurge({
        next: async () => [{ bucket: "b", name: "a/b" }],
        remove: async () => {
          throw new Error("nope");
        },
      }),
    ).rejects.toThrow("nope");
  });
});
