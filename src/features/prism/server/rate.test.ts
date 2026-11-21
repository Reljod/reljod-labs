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

  it("counts units under a transaction-scoped advisory lock and enforces the hourly cap", async () => {
    let used = 0;
    const lockedKeys: string[] = [];

    beginMock.mockImplementation(
      async (
        cb: (
          tx: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>,
        ) => Promise<boolean>,
      ) => {
        const tx = async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          const query = strings.join("?");
          if (query.includes("pg_advisory_xact_lock")) {
            lockedKeys.push(String(values[0]));
            return [];
          }
          const units = Number(values[5]);
          const limit = Number(values[7]);
          if (used + units <= limit) {
            used += units;
            return [{ taken: true }];
          }
          return [{ taken: false }];
        };
        return cb(tx);
      },
    );

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
    expect(used).toBe(LIMITS.cascadeCallsPerHour);
    expect(lockedKeys[0]).toBe("prism:visitor-hash-1:cascade");

    // One more unit past the hourly call budget is refused.
    await expect(takeRate(who, "guest:pass-1", "cascade", 1)).rejects.toThrow(
      LimitError,
    );
  });
});
