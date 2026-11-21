import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "../domain/limits";

vi.mock("server-only", () => ({}));

const { bucketLimits, evaluateRateBudget } = await import("./rate");

describe("helio Postgres rate budget evaluation", () => {
  it("enforces per-visitor hourly caps with multi-unit shoots", () => {
    const { hourLimit } = bucketLimits("image");

    expect(
      evaluateRateBudget({
        bucket: "image",
        units: 3,
        visitorUsedHour: hourLimit - 3,
        globalUsedDay: 10,
      }),
    ).toEqual({ ok: true });

    const overVisitor = evaluateRateBudget({
      bucket: "image",
      units: 3,
      visitorUsedHour: hourLimit - 2,
      globalUsedDay: 10,
    });
    expect(overVisitor.ok).toBe(false);
    if (!overVisitor.ok) {
      expect(overVisitor.message).toContain(`${LIMITS.imageCallsPerHour}/hr`);
    }
  });

  it("enforces global 24-hour caps across all visitors", () => {
    const { dayLimit } = bucketLimits("director");

    expect(
      evaluateRateBudget({
        bucket: "director",
        units: 1,
        visitorUsedHour: 0,
        globalUsedDay: dayLimit - 1,
      }),
    ).toEqual({ ok: true });

    const overGlobal = evaluateRateBudget({
      bucket: "director",
      units: 1,
      visitorUsedHour: 0,
      globalUsedDay: dayLimit,
    });
    expect(overGlobal.ok).toBe(false);
    if (!overGlobal.ok) {
      expect(overGlobal.message).toContain("Daily studio quota");
    }
  });
});
