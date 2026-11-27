import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const beginMock = vi.fn();
vi.mock("./db", () => ({
  sql: () => ({
    begin: beginMock,
  }),
}));

import { LIMITS } from "../domain/limits";
import { LimitError } from "./errors";
import { takeRate } from "./rate";

describe("prism durable rate limiter", () => {
  beforeEach(() => {
    beginMock.mockReset();
  });

  it("skips database hits for trusted e2e visitors", async () => {
    const trusted = { hash: "e2e", trusted: true, stubbed: true };
    await expect(
      takeRate(trusted, "e2e", "cascade", 12),
    ).resolves.toBeUndefined();
    expect(beginMock).not.toHaveBeenCalled();
  });

  /** A fake transaction over one table of hits: `{ hash, units }` rows. */
  function fakeDb(hits: { hash: string; units: number }[], locks: string[]) {
    beginMock.mockImplementation(
      async (
        cb: (
          tx: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>,
        ) => Promise<unknown>,
      ) => {
        const tx = async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          const query = strings.join("?");
          if (query.includes("pg_advisory_xact_lock")) {
            locks.push(String(values[0] ?? "prism:all"));
            return [];
          }
          if (query.includes("insert into prism.rate_hits")) {
            hits.push({ hash: String(values[1]), units: Number(values[3]) });
            return [];
          }
          const hash = String(values[0]);
          const sum = (rows: typeof hits) =>
            rows.reduce((total, row) => total + row.units, 0);
          return [
            {
              hour: sum(hits.filter((row) => row.hash === hash)),
              day: sum(hits),
            },
          ];
        };
        return cb(tx);
      },
    );
  }

  it("counts units under transaction-scoped advisory locks and enforces the hourly cap", async () => {
    const hits: { hash: string; units: number }[] = [];
    const lockedKeys: string[] = [];
    fakeDb(hits, lockedKeys);

    const who = { hash: "visitor-hash-1", trusted: false, stubbed: false };
    const callsPerCascade = 12;
    const allowedRuns = Math.floor(
      LIMITS.cascadeCallsPerHour / callsPerCascade,
    );

    for (let i = 0; i < allowedRuns; i++) {
      await expect(
        takeRate(who, "guest:pass-1", "cascade", callsPerCascade),
      ).resolves.toBeUndefined();
    }
    expect(hits.reduce((total, row) => total + row.units, 0)).toBe(
      LIMITS.cascadeCallsPerHour,
    );
    expect(lockedKeys[0]).toBe("prism:visitor-hash-1:cascade");
    expect(lockedKeys[1]).toBe("prism:all");

    // One more unit past the hourly call budget is refused.
    await expect(takeRate(who, "guest:pass-1", "cascade", 1)).rejects.toThrow(
      LimitError,
    );
  });

  it("refuses every visitor once today's global calls are used", async () => {
    const hits = [{ hash: "others", units: LIMITS.callsPerDay }];
    fakeDb(hits, []);
    const fresh = { hash: "visitor-hash-2", trusted: false, stubbed: false };
    await expect(takeRate(fresh, "guest:pass-2", "refract", 1)).rejects.toThrow(
      /today/,
    );
    expect(hits).toHaveLength(1);
  });
});
