import { describe, expect, it } from "vitest";
import {
  defaultExamples,
  EXAMPLES,
  EXAMPLES_SHOWN,
  hasMoreExamples,
} from "./examples";

describe("Teller example prompts", () => {
  it("keeps the default set at its old size, first examples first", () => {
    expect(EXAMPLES_SHOWN).toBe(6);
    expect(defaultExamples()).toEqual(EXAMPLES.slice(0, 6));
  });

  it("offers See more because the full list is longer", () => {
    expect(EXAMPLES.length).toBeGreaterThan(EXAMPLES_SHOWN);
    expect(hasMoreExamples()).toBe(true);
  });

  it("does not offer See more when nothing is hidden", () => {
    expect(hasMoreExamples(["a", "b"], 2)).toBe(false);
    expect(hasMoreExamples(["a"], 6)).toBe(false);
    expect(hasMoreExamples([], 0)).toBe(false);
  });

  it("never shows more than asked, nor a negative count", () => {
    expect(defaultExamples(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(defaultExamples(["a", "b"], -1)).toEqual([]);
  });

  it("has no duplicate or empty examples", () => {
    expect(new Set(EXAMPLES).size).toBe(EXAMPLES.length);
    for (const example of EXAMPLES) expect(example.trim()).not.toBe("");
  });
});
