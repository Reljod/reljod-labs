import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "../domain/limits";
import {
  _resetRateBucketsForTests,
  hashVisitor,
  RateLimitError,
  takeRate,
} from "./rate";

describe("helio rate limiter", () => {
  beforeEach(() => {
    _resetRateBucketsForTests();
  });

  it("enforces per-visitor hourly caps with multi-unit shoots", () => {
    const now = 1_700_000_000_000;
    const visitorKey = hashVisitor("guest:pass-1", "test-salt");

    // Exhaust hourly image quota in 3-market bursts
    const bursts = Math.floor(LIMITS.imageCallsPerHour / 3);
    for (let i = 0; i < bursts; i++) {
      takeRate({ visitorKey, bucket: "image", units: 3, now: now + i * 1000 });
    }

    expect(() =>
      takeRate({
        visitorKey,
        bucket: "image",
        units: 1,
        now: now + bursts * 1000,
      }),
    ).toThrow(RateLimitError);

    // Another visitor is still allowed
    const otherKey = hashVisitor("guest:pass-2", "test-salt");
    expect(() =>
      takeRate({ visitorKey: otherKey, bucket: "image", units: 3, now }),
    ).not.toThrow();

    // After 1 hour window passes, original visitor recovers
    expect(() =>
      takeRate({
        visitorKey,
        bucket: "image",
        units: 3,
        now: now + 61 * 60 * 1000,
      }),
    ).not.toThrow();
  });
});
