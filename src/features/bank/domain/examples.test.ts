import { describe, expect, it } from "vitest";
import { exampleView, SHOWN_EXAMPLES, TELLER_EXAMPLES } from "./examples";
import { LIMITS } from "./limits";

describe("Teller example prompts", () => {
  it("shows the same six examples by default and has more behind See more", () => {
    const view = exampleView();
    expect(SHOWN_EXAMPLES).toBe(6);
    expect(view.shown).toEqual(TELLER_EXAMPLES.slice(0, 6));
    expect(view.shown[0]).toBe(
      "What can Mara spend right now, and why is it less than her balance?",
    );
    expect(view.hasMore).toBe(true);
  });

  it("offers no See more when every example already shows", () => {
    expect(exampleView(["a", "b"], 6)).toEqual({
      shown: ["a", "b"],
      hasMore: false,
    });
    expect(exampleView(["a", "b", "c"], 3).hasMore).toBe(false);
  });

  it("refuses a negative or fractional count instead of slicing from the end", () => {
    expect(exampleView(["a", "b"], -1)).toEqual({ shown: [], hasMore: true });
    expect(exampleView(["a", "b", "c"], 1.7).shown).toEqual(["a"]);
  });

  it("keeps every example unique, non-empty and short enough to send", () => {
    expect(new Set(TELLER_EXAMPLES).size).toBe(TELLER_EXAMPLES.length);
    for (const example of TELLER_EXAMPLES) {
      expect(example.trim()).not.toBe("");
      expect(example.length).toBeLessThanOrEqual(LIMITS.messageChars);
    }
  });
});
