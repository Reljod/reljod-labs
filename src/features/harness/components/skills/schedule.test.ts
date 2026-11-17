import { describe, expect, it } from "vitest";
import { draftSchedule, savedSchedule, scheduledCount } from "./schedule";

const state = (version: number, effectiveFrom: string) =>
  ({ version, effectiveFrom }) as never;

describe("savedSchedule", () => {
  it("says nothing when the latest Version is in force", () => {
    expect(
      savedSchedule({
        state: state(2, "2026-01-01"),
        inForce: { version: 2, effectiveFrom: "2026-01-01" },
      }),
    ).toEqual({ kind: "in-force", text: null });
  });

  it("scheduled over an earlier Version", () => {
    expect(
      savedSchedule({
        state: state(3, "2027-01-01"),
        inForce: { version: 2, effectiveFrom: "2026-01-01" },
      }),
    ).toEqual({
      kind: "over-version",
      text: "Scheduled: Version 3 takes effect on 2027-01-01. Until then Runs use Version 2.",
    });
  });

  it("scheduled over the Default", () => {
    expect(
      savedSchedule({
        state: state(1, "2027-01-01"),
        inForce: { version: 0, effectiveFrom: "2025-01-01" },
      }).text,
    ).toBe(
      "Scheduled: Version 1 takes effect on 2027-01-01. Until then Runs use the Default.",
    );
  });

  it("not yet in force at all", () => {
    expect(
      savedSchedule({ state: state(1, "2027-01-01"), inForce: null }),
    ).toEqual({
      kind: "not-yet",
      text: "Scheduled: Version 1 takes effect on 2027-01-01. Until then this Rule is not in force yet.",
    });
  });
});

describe("draftSchedule", () => {
  const view = {
    state: state(2, "2026-01-01"),
    inForce: { version: 2, effectiveFrom: "2026-01-01" },
  };
  it("hints only for a future, well-formed date", () => {
    expect(draftSchedule(view, "2026-11-17", "2026-11-17").text).toBeNull();
    expect(draftSchedule(view, "2026-11-16", "2026-11-17").text).toBeNull();
    expect(draftSchedule(view, "2026-1", "2026-11-17").text).toBeNull();
    expect(draftSchedule(view, "2026-11-18", "2026-11-17").text).toBe(
      "Scheduled: this edit (Version 3) takes effect on 2026-11-18. Until then Runs use Version 2.",
    );
  });
  it("names the Default and the not-in-force cases", () => {
    expect(
      draftSchedule(
        {
          state: state(0, "2025-01-01"),
          inForce: { version: 0, effectiveFrom: "2025-01-01" },
        },
        "2027-01-01",
        "2026-11-17",
      ).text,
    ).toContain("Runs use the Default");
    expect(
      draftSchedule(
        { state: state(1, "2027-01-01"), inForce: null },
        "2028-01-01",
        "2026-11-17",
      ).text,
    ).toContain("not in force yet");
  });
});

describe("scheduledCount", () => {
  it("counts Rules whose latest Version is not in force", () => {
    expect(
      scheduledCount([
        {
          state: state(1, "2026-01-01"),
          inForce: { version: 1, effectiveFrom: "2026-01-01" },
        },
        {
          state: state(2, "2027-01-01"),
          inForce: { version: 1, effectiveFrom: "2026-01-01" },
        },
        { state: state(1, "2027-01-01"), inForce: null },
      ]),
    ).toBe(2);
  });
});
