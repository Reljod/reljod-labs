import { afterEach, describe, expect, it, vi } from "vitest";

const signing = vi.hoisted(() => ({ batches: [] as string[][], n: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({
  env: {
    supabaseUrl: () => "https://project.test",
    supabaseServiceRoleKey: () => "test-key",
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          signing.batches.push(paths);
          signing.n += 1;
          return {
            data: paths.map((path) => ({
              path,
              signedUrl: `https://cdn.test/${path}?token=${signing.n}`,
            })),
            error: null,
          };
        },
      }),
    },
  }),
}));

const { packPageUrls } = await import("./supabase");

afterEach(() => {
  vi.useRealTimers();
});

describe("packPageUrls", () => {
  it("signs a page once and reuses the URL while it has an hour left", async () => {
    vi.useFakeTimers({ now: 0 });
    const first = await packPageUrls(["a/1.png", "a/2.png"]);
    const again = await packPageUrls(["a/2.png", "a/1.png", "b/1.png"]);
    expect(again.get("a/1.png")).toBe(first.get("a/1.png"));
    expect(signing.batches).toEqual([["a/1.png", "a/2.png"], ["b/1.png"]]);

    // Past the hour mark the URL has under an hour left: signed again.
    vi.setSystemTime(60 * 60 * 1000 + 1);
    const later = await packPageUrls(["a/1.png"]);
    expect(later.get("a/1.png")).not.toBe(first.get("a/1.png"));
    expect(signing.batches.at(-1)).toEqual(["a/1.png"]);
  });
});
