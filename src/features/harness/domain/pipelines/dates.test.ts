import { describe, expect, it } from "vitest";
import { bankToday } from "./dates";

describe("bankToday", () => {
  it("is still yesterday in Cayman just after midnight UTC", () => {
    expect(bankToday(new Date("2026-11-18T00:30:00Z"))).toBe("2026-11-17");
    expect(bankToday(new Date("2026-11-18T04:59:59Z"))).toBe("2026-11-17");
  });

  it("turns over at 05:00 UTC, all year (no daylight saving)", () => {
    expect(bankToday(new Date("2026-11-18T05:00:00Z"))).toBe("2026-11-18");
    expect(bankToday(new Date("2026-07-01T04:59:00Z"))).toBe("2026-06-30");
    expect(bankToday(new Date("2026-07-01T05:00:00Z"))).toBe("2026-07-01");
  });

  it("crosses a year end", () => {
    expect(bankToday(new Date("2027-01-01T03:00:00Z"))).toBe("2026-12-31");
  });
});
