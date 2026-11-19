import { describe, expect, it } from "vitest";
import { capitalCountWord, countWord } from "./count-words";

describe("countWord", () => {
  it("spells small counts", () => {
    expect(countWord(0)).toBe("zero");
    expect(countWord(7)).toBe("seven");
    expect(countWord(12)).toBe("twelve");
    expect(countWord(19)).toBe("nineteen");
  });

  it("spells tens, with a hyphen when there are ones", () => {
    expect(countWord(20)).toBe("twenty");
    expect(countWord(21)).toBe("twenty-one");
    expect(countWord(99)).toBe("ninety-nine");
  });

  it("falls back to digits past ninety-nine, below zero and for fractions", () => {
    expect(countWord(100)).toBe("100");
    expect(countWord(-1)).toBe("-1");
    expect(countWord(1.5)).toBe("1.5");
  });

  it("capitalises for the start of a sentence", () => {
    expect(capitalCountWord(12)).toBe("Twelve");
    expect(capitalCountWord(34)).toBe("Thirty-four");
  });
});
