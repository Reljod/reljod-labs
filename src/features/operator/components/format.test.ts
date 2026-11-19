import { describe, expect, it } from "vitest";
import { bytes, clock, duration, errorsLabel, modelLabel, usd } from "./format";

describe("format", () => {
  it("shows small costs with four decimals", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.0042)).toBe("$0.0042");
    expect(usd(1.256)).toBe("$1.26");
  });

  it("writes a duration in words", () => {
    expect(duration(840)).toBe("840 ms");
    expect(duration(12_400)).toBe("12.4 s");
    expect(duration(187_000)).toBe("3m 07s");
  });

  it("runs a clock that never goes negative", () => {
    expect(clock(-50)).toBe("0:00");
    expect(clock(7_900)).toBe("0:07");
    expect(clock(760_000)).toBe("12:40");
    expect(clock(3_725_000)).toBe("1:02:05");
  });

  it("names sizes, models and error counts", () => {
    expect(bytes(512_000)).toBe("512 KB");
    expect(bytes(2_400_000)).toBe("2.4 MB");
    expect(modelLabel("anthropic/claude-haiku-5.5")).toBe("Claude Haiku 5.5");
    expect(modelLabel("other/model")).toBe("other/model");
    expect(modelLabel(null)).toBe("no model");
    expect(errorsLabel(1)).toBe("1 error");
    expect(errorsLabel(3)).toBe("3 errors");
  });
});
