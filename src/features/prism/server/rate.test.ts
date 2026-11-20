import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import { LIMITS } from "../domain/limits";
import { LimitError } from "./errors";
import { takeRate } from "./rate";

describe("prism rate limiter", () => {
  it("skips hourly caps for trusted e2e visitors", () => {
    const trusted = { hash: "e2e", trusted: true, stubbed: true };
    for (let i = 0; i < LIMITS.cascadesPerHour + 5; i++) {
      expect(() => takeRate(trusted, "cascade")).not.toThrow();
    }
  });

  it("enforces hourly caps for untrusted visitors before paid work runs", () => {
    const visitor = {
      hash: `test-visitor-${Date.now()}`,
      trusted: false,
      stubbed: false,
    };
    for (let i = 0; i < LIMITS.cascadesPerHour; i++) {
      expect(() => takeRate(visitor, "cascade")).not.toThrow();
    }
    expect(() => takeRate(visitor, "cascade")).toThrow(LimitError);
  });
});
