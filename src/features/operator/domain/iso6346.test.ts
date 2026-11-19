import { describe, expect, it } from "vitest";
import {
  checkDigit,
  containerNumber,
  isValidContainer,
  normaliseContainer,
  spacedContainer,
} from "./iso6346";

describe("checkDigit", () => {
  it("matches the standard's worked example", () => {
    expect(checkDigit("CSQU305438")).toBe(3);
    expect(checkDigit("MRDU482113")).toBe(1);
  });

  it("writes a remainder of 10 as 0", () => {
    // The standard's letter table, written out, as an independent check.
    const table = [
      10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29,
      30, 31, 32, 34, 35, 36, 37, 38,
    ];
    const remainder = (first10: string) =>
      [...first10].reduce((sum, ch, i) => {
        const value = i < 4 ? table[ch.charCodeAt(0) - 65] : Number(ch);
        return sum + value * 2 ** i;
      }, 0) % 11;
    let tens = 0;
    for (let serial = 100000; serial < 100300; serial += 1) {
      const first10 = `MRDU${serial}`;
      const left = remainder(first10);
      if (left === 10) tens += 1;
      expect(checkDigit(first10), first10).toBe(left === 10 ? 0 : left);
    }
    expect(tens).toBeGreaterThan(10);
  });

  it("answers null for anything that is not 4 letters and 6 digits", () => {
    for (const bad of [
      "",
      "MRDU48211",
      "MRDU4821131",
      "mrdu482113",
      "MRD1482113",
      "MRDU48211A",
    ]) {
      expect(checkDigit(bad), bad).toBeNull();
    }
  });
});

describe("isValidContainer", () => {
  it("accepts the right digit and refuses every other", () => {
    expect(isValidContainer("CSQU3054383")).toBe(true);
    expect(isValidContainer("MRDU4821131")).toBe(true);
    for (const digit of "023456789") {
      expect(isValidContainer(`MRDU482113${digit}`)).toBe(false);
    }
  });

  it("refuses what is not normalised or not 11 characters", () => {
    for (const bad of [
      "MRDU 482113 1",
      "MRDU 482113",
      "mrdu4821131",
      "MRDU482113",
      "MRDU48211311",
      "",
    ]) {
      expect(isValidContainer(bad), bad).toBe(false);
    }
  });

  it("catches a transposed pair of digits", () => {
    expect(isValidContainer("MRDU4812131")).toBe(false);
  });
});

describe("normaliseContainer", () => {
  it("strips spaces and dashes and upper-cases", () => {
    expect(normaliseContainer(" mrdu 482113-1 ")).toBe("MRDU4821131");
    expect(normaliseContainer("MRDU\t482113 1")).toBe("MRDU4821131");
    expect(normaliseContainer("")).toBe("");
  });

  it("round-trips with the spaced form", () => {
    const full = containerNumber("TRSU", "330418");
    expect(full).toBe("TRSU3304186");
    expect(spacedContainer(full)).toBe("TRSU 330418 6");
    expect(normaliseContainer(spacedContainer(full))).toBe(full);
  });
});
