import { describe, expect, it } from "vitest";
import { parseMrzDate, parsePrintedDate, subtractMonths } from "./dates";

describe("parsePrintedDate", () => {
  it.each([
    ["14 MAR 1991", "1991-03-14"],
    ["02 Oct 2026", "2026-10-02"],
    ["9 September 2029", "2029-09-09"],
    ["20Oct 2026", "2026-10-20"],
    ["20Oct2026", "2026-10-20"],
    ["1991-03-14", "1991-03-14"],
  ])("reads %s", (text, expected) => {
    expect(parsePrintedDate(text)).toBe(expected);
  });

  it.each([
    "31 FEB 2026",
    "03/14/1991",
    "MAR 1991",
    "",
  ])("rejects %s", (text) => {
    expect(parsePrintedDate(text)).toBeNull();
  });
});

describe("parseMrzDate", () => {
  it("puts expiry dates in this century", () => {
    expect(parseMrzDate("250911", "expiry", "2026-11-07")).toBe("2025-09-11");
  });

  it("puts future-looking birth dates in the last century", () => {
    expect(parseMrzDate("910314", "birth", "2026-11-07")).toBe("1991-03-14");
    expect(parseMrzDate("050101", "birth", "2026-11-07")).toBe("2005-01-01");
  });

  it("rejects anything that is not six digits", () => {
    expect(parseMrzDate("25091", "expiry", "2026-11-07")).toBeNull();
  });
});

describe("subtractMonths", () => {
  it("keeps the day of the month", () => {
    expect(subtractMonths("2026-11-07", 3)).toBe("2026-08-07");
  });

  it("crosses a year boundary", () => {
    expect(subtractMonths("2026-02-15", 3)).toBe("2025-11-15");
  });

  it("clamps to the end of a shorter month", () => {
    expect(subtractMonths("2026-05-31", 3)).toBe("2026-02-28");
  });
});
