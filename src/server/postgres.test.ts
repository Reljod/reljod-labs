import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isoTimestamp } = await import("./postgres");

describe("isoTimestamp", () => {
  it("prints a timestamptz the way the Data API did", () => {
    expect(isoTimestamp("2026-11-27 10:00:00.123456+00")).toBe(
      "2026-11-27T10:00:00.123456+00:00",
    );
    expect(isoTimestamp("2026-11-27 10:00:00+05:30")).toBe(
      "2026-11-27T10:00:00+05:30",
    );
  });

  it("leaves a timestamp without a zone without one", () => {
    expect(isoTimestamp("2026-11-27 10:00:00.5")).toBe("2026-11-27T10:00:00.5");
  });

  it("parses to the same instant", () => {
    const value = isoTimestamp("2026-11-27 10:00:00.123456+00");
    expect(new Date(value).toISOString()).toBe("2026-11-27T10:00:00.123Z");
  });
});
