import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, limitMessage } from "../domain/limits";

const state = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as null | { message: string } },
}));

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({
  supabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      return state.reply;
    },
  }),
}));

const { rateLimitMessage, takeBuildRate } = await import("./rate-limit");

const visitor = {
  hash: "visitor-hash",
  limited: true,
  stubbed: false,
  forceLimit: false,
};

beforeEach(() => {
  state.calls = [];
  state.reply = { data: null, error: null };
});

describe("takeBuildRate", () => {
  it("takes a hit for the visitor against both caps before the Build runs", async () => {
    await expect(takeBuildRate(visitor)).resolves.toBeNull();
    expect(state.calls).toEqual([
      {
        fn: "take_rate_hit",
        args: {
          p_visitor_hash: "visitor-hash",
          p_per_hour: LIMITS.buildsPerVisitorPerHour,
          p_per_day: LIMITS.buildsPerDay,
          p_take: true,
        },
      },
    ]);
  });

  it("refuses with the visitor message when the hour is used up", async () => {
    state.reply = { data: "visitor", error: null };
    await expect(takeBuildRate(visitor)).resolves.toBe(limitMessage("visitor"));
  });

  it("refuses with the site message when the day is used up", async () => {
    state.reply = { data: "site", error: null };
    const message = await takeBuildRate(visitor);
    expect(message).toMatch(/today's question limit/);
    expect(message).toMatch(/recent answer instead/);
  });

  it("throws when the database cannot take the hit, so nothing is spent", async () => {
    state.reply = { data: null, error: { message: "boom" } };
    await expect(takeBuildRate(visitor)).rejects.toThrow(/rate limit/);
  });

  it("skips the count for the e2e suite, but honours a forced limit", async () => {
    const e2e = { ...visitor, limited: false };
    await expect(takeBuildRate(e2e)).resolves.toBeNull();
    await expect(takeBuildRate({ ...e2e, forceLimit: true })).resolves.toBe(
      limitMessage("visitor"),
    );
    expect(state.calls).toEqual([]);
  });
});

describe("rateLimitMessage", () => {
  it("only peeks: it never records a hit", async () => {
    state.reply = { data: "site", error: null };
    await expect(rateLimitMessage(visitor)).resolves.toBe(limitMessage("site"));
    expect(state.calls[0]?.args.p_take).toBe(false);
  });
});

describe("limitMessage", () => {
  it("lets a Build through only on a null answer", () => {
    expect(limitMessage(null)).toBeNull();
    expect(limitMessage(undefined)).toBeNull();
    expect(limitMessage("visitor")).toMatch(
      new RegExp(`${LIMITS.buildsPerVisitorPerHour} of your questions`),
    );
    // An answer it does not know refuses rather than spends.
    expect(limitMessage("something else")).toBe(limitMessage("visitor"));
  });
});
