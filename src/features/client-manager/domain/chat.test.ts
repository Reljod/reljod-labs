import { describe, expect, it } from "vitest";
import { titleFrom } from "./chat";
import { certaintyOf } from "./confidence";

describe("titleFrom", () => {
  it("keeps a short question whole", () => {
    expect(titleFrom("  Who is Ivy?\n")).toBe("Who is Ivy?");
    expect(titleFrom("   ")).toBe("New chat");
  });

  it("cuts a long one at a word", () => {
    const title = titleFrom(
      "Which of my clients have a liquidity event in the next twelve months and should hear from me first?",
    );
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });
});

describe("certaintyOf", () => {
  it("draws three steps", () => {
    expect(certaintyOf(0.95)).toBe("high");
    expect(certaintyOf(0.8)).toBe("high");
    expect(certaintyOf(0.7)).toBe("medium");
    expect(certaintyOf(0.6)).toBe("medium");
    expect(certaintyOf(0.3)).toBe("low");
  });
});
