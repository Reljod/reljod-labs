import { describe, expect, it } from "vitest";
import {
  modelsChangeSummary,
  ruleChangeSummary,
  rulesResetSummary,
} from "./audit-summary";
import { DEFAULT_MODELS } from "./models";
import { type RuleOverrides, resolveRules } from "./rules";

const rule = (id: string, overrides: RuleOverrides = {}) => {
  const found = resolveRules(overrides).find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("ruleChangeSummary", () => {
  it("says which Parameter changed, old to new", () => {
    expect(
      ruleChangeSummary(
        rule("content.max-bullets"),
        rule("content.max-bullets", {
          "content.max-bullets": { params: { max: 2 } },
        }),
      ),
    ).toBe("Changed 'Few points per slide': Bullets 4 to 2");
  });

  it("names units, switches and severity", () => {
    expect(
      ruleChangeSummary(
        rule("layout.safe-area"),
        rule("layout.safe-area", {
          "layout.safe-area": {
            enabled: false,
            severity: "warn",
            params: { margin: 64 },
          },
        }),
      ),
    ).toBe(
      "Changed 'Inside the margins': turned off, now only warns, Margin 48 px to 64 px",
    );
  });

  it("says when nothing changed", () => {
    expect(
      ruleChangeSummary(rule("loop.reviewer"), rule("loop.reviewer")),
    ).toBe("Kept 'A second model reviews the deck' as it was");
  });
});

describe("rulesResetSummary", () => {
  it("lists the Rules that were edited", () => {
    const edited = resolveRules({
      "content.max-bullets": { params: { max: 2 } },
    }).filter((item) => item.edited);
    expect(rulesResetSummary(edited)).toBe(
      "Reset 1 Rule to its default: 'Few points per slide'",
    );
    expect(rulesResetSummary([])).toBe("Reset the Rules (none were changed)");
  });
});

describe("modelsChangeSummary", () => {
  it("names each purpose that changed", () => {
    expect(
      modelsChangeSummary(DEFAULT_MODELS, {
        ...DEFAULT_MODELS,
        write: "anthropic/claude-sonnet-5.5",
      }),
    ).toBe("Changed models. Write: Claude Haiku 5.5 to Claude Sonnet 5.5");
  });
});
