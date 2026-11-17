import { describe, expect, it } from "vitest";
import { formatDuration, formatTokens, humanize, timeAgo } from "./format";

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(4200)).toBe("4.2 s");
    expect(formatDuration(30_000)).toBe("30 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
    expect(formatDuration(-1)).toBe("–");
  });
  it("formats token counts", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(45_000)).toBe("45k");
  });
  it("says how long ago", () => {
    const now = Date.parse("2026-01-02T12:00:00Z");
    expect(timeAgo("2026-01-02T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-01-02T11:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-01-02T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2025-12-30T12:00:00Z", now)).toBe("3 d ago");
  });
  it("humanizes an id", () => {
    expect(humanize("member_request")).toBe("Member request");
  });
});
