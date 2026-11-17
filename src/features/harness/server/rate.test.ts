import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  log: [] as string[],
  taken: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("./env", () => ({
  env: { e2eBypassToken: () => "", rateLimitSalt: () => "salt" },
}));
vi.mock("./db", () => {
  const tag =
    (where: string) =>
    (strings: TemplateStringsArray, ..._values: unknown[]) => {
      state.log.push(
        `${where}: ${strings.join("$").replace(/\s+/g, " ").trim()}`,
      );
      return Promise.resolve([{ taken: state.taken }]);
    };
  const db = Object.assign(tag("db"), {
    begin: async (fn: (tx: unknown) => unknown) => {
      state.log.push("begin");
      const result = await fn(tag("tx"));
      state.log.push("commit");
      return result;
    },
  });
  return { sql: () => db };
});

import { LimitError } from "./errors";
import { takeRate } from "./rate";

const who = { hash: "abc", trusted: false };

beforeEach(() => {
  state.log = [];
  state.taken = true;
});

describe("takeRate", () => {
  it("counts and inserts under an advisory lock on (visitor, kind), in one transaction", async () => {
    await takeRate(who, "e2e", "search");
    expect(state.log[0]).toBe("begin");
    expect(state.log[1]).toMatch(
      /^tx: select pg_advisory_xact_lock\(hashtextextended/,
    );
    expect(state.log[2]).toMatch(/^tx: with recent as/);
    expect(state.log[3]).toBe("commit");
  });

  it("refuses when this hour's allowance is used", async () => {
    state.taken = false;
    await expect(takeRate(who, "e2e", "run")).rejects.toThrow(LimitError);
  });

  it("lets a trusted visitor through without touching the database", async () => {
    await takeRate({ hash: "e2e", trusted: true }, "e2e", "run");
    expect(state.log).toEqual([]);
  });
});
