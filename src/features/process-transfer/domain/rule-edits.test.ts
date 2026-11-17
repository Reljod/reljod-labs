import { describe, expect, it } from "vitest";
import { withRuleOverride } from "./rule-edits";

describe("withRuleOverride", () => {
  it("replaces the stored override, so a field put back to default is gone", () => {
    expect(
      withRuleOverride(
        { "content.max-bullets": { severity: "warn" } },
        "content.max-bullets",
        { params: { max: 3 } },
      ),
    ).toEqual({ "content.max-bullets": { params: { max: 3 } } });
    expect(
      withRuleOverride(
        { "layout.text-fits": { severity: "warn" } },
        "layout.text-fits",
        {},
      ),
    ).toEqual({});
  });

  it("drops a value equal to the default and leaves other Rules alone", () => {
    expect(
      withRuleOverride(
        { "layout.safe-area": { params: { margin: 64 } } },
        "content.max-bullets",
        { params: { max: 4 } },
      ),
    ).toEqual({ "layout.safe-area": { params: { margin: 64 } } });
  });

  it("puts a Rule back to its default with null", () => {
    expect(
      withRuleOverride(
        { "content.max-bullets": { params: { max: 2 } } },
        "content.max-bullets",
        null,
      ),
    ).toEqual({});
  });
});
