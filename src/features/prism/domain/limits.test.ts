import { describe, expect, it } from "vitest";
import { LIMITS, rateVerdict } from "./limits";

describe("rateVerdict", () => {
  it("takes calls that fit under the hour and the day", () => {
    expect(
      rateVerdict({ units: 4, perHour: 120, usedHour: 0, usedDay: 0 }),
    ).toBe("taken");
  });

  it("refuses calls past the visitor's hour", () => {
    expect(
      rateVerdict({ units: 4, perHour: 120, usedHour: 118, usedDay: 0 }),
    ).toBe("hour");
  });

  it("refuses everyone once today's global calls would be exceeded", () => {
    expect(
      rateVerdict({
        units: 1,
        perHour: 120,
        usedHour: 0,
        usedDay: LIMITS.callsPerDay,
      }),
    ).toBe("day");
    expect(
      rateVerdict({
        units: 3,
        perHour: 120,
        usedHour: 0,
        usedDay: LIMITS.callsPerDay - 2,
      }),
    ).toBe("day");
  });
});
