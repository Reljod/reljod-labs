import { describe, expect, it, vi } from "vitest";
import { LIMITS } from "../domain/limits";

vi.mock("server-only", () => ({}));

const { rateRefusal } = await import("./rate");

describe("Helio's caps", () => {
  it("refuse a multi-unit Shoot that would pass the visitor's hour", () => {
    const hour = LIMITS.imageCallsPerHour;
    expect(
      rateRefusal({
        bucket: "image",
        units: 3,
        visitorUsedHour: hour - 3,
        globalUsedDay: 10,
      }),
    ).toBeNull();
    expect(
      rateRefusal({
        bucket: "image",
        units: 3,
        visitorUsedHour: hour - 2,
        globalUsedDay: 10,
      }),
    ).toContain(`${hour}/hr`);
  });

  it("refuse every visitor once everyone's day is used", () => {
    const day = LIMITS.directorCallsPerDayGlobal;
    expect(
      rateRefusal({
        bucket: "director",
        units: 1,
        visitorUsedHour: 0,
        globalUsedDay: day - 1,
      }),
    ).toBeNull();
    expect(
      rateRefusal({
        bucket: "director",
        units: 1,
        visitorUsedHour: 0,
        globalUsedDay: day,
      }),
    ).toContain("Daily studio quota");
  });
});
