import { describe, expect, it } from "vitest";
import {
  ago,
  bytes,
  count,
  elapsed,
  fileSlug,
  plural,
  seconds,
  usd,
  usdCents,
} from "./format";

describe("usd", () => {
  it("shows four decimals under a dollar and two above", () => {
    expect(usd(0.0421)).toBe("$0.0421");
    expect(usd(1.5)).toBe("$1.50");
    expect(usd(0)).toBe("$0.00");
  });
});

describe("usdCents", () => {
  it("rounds to the cent and marks tiny amounts", () => {
    expect(usdCents(0.04)).toBe("$0.04");
    expect(usdCents(1.5)).toBe("$1.50");
    expect(usdCents(0.001)).toBe("<$0.01");
    expect(usdCents(0)).toBe("$0.00");
  });
});

describe("elapsed and seconds", () => {
  it("reads like a person would say it", () => {
    expect(elapsed(420)).toBe("420 ms");
    expect(elapsed(4200)).toBe("4.2 s");
    expect(elapsed(72_000)).toBe("1 m 12 s");
    expect(elapsed(null)).toBe("—");
    expect(seconds(42)).toBe("42 s");
    expect(seconds(600)).toBe("10 m");
  });
});

describe("bytes and count", () => {
  it("formats sizes and token counts", () => {
    expect(bytes(3.2 * 1024 * 1024)).toBe("3.2 MB");
    expect(bytes(820 * 1024)).toBe("820 KB");
    expect(count(12345)).toBe("12,345");
    expect(plural(1, "step")).toBe("1 step");
    expect(plural(3, "step")).toBe("3 steps");
  });
});

describe("ago", () => {
  it("counts back from now", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(ago("2026-11-17T11:59:50Z", now)).toBe("just now");
    expect(ago("2026-11-17T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-11-17T09:00:00Z", now)).toBe("3 h ago");
  });
});

describe("fileSlug", () => {
  it("keeps only safe characters", () => {
    expect(fileSlug("Month-end contribution reconciliation")).toBe(
      "month-end-contribution-reconciliation",
    );
    expect(fileSlug("Café / ../../etc: “wire” recall")).toBe(
      "cafe-etc-wire-recall",
    );
    expect(fileSlug("***")).toBe("handover");
    expect(fileSlug("a".repeat(80)).length).toBe(60);
  });
});
