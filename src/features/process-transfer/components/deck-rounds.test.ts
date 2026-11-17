import { describe, expect, it } from "vitest";
import type { Deck, Slide } from "../domain/deck";
import { resolveRules } from "../domain/rules";
import {
  emptyChecksLine,
  firstRoundLine,
  maxRounds,
  redoWarning,
  roundDiff,
  roundLabel,
  roundStats,
  slideIndexFor,
  slideName,
} from "./deck-rounds";

const slide = (id: string, planId: string) =>
  ({ id, planId }) as unknown as Slide;
const deck = {
  slides: [slide("a", "p1"), slide("b", "p2"), slide("c", "p2")],
} as Pick<Deck, "slides">;

const failing = {
  round: 1,
  passed: false,
  checks: [
    {
      ruleId: "a",
      severity: "block" as const,
      passed: false,
      summary: "",
      failures: [],
    },
    {
      ruleId: "b",
      severity: "warn" as const,
      passed: false,
      summary: "",
      failures: [],
    },
    {
      ruleId: "c",
      severity: "block" as const,
      passed: true,
      summary: "",
      failures: [],
    },
  ],
  findings: [
    { target: "p2", severity: "major" as const, issue: "", fix: "" },
    { target: null, severity: "minor" as const, issue: "", fix: "" },
  ],
};

describe("roundStats and roundLabel", () => {
  it("counts blocking failures, warnings and Findings", () => {
    expect(roundStats(failing)).toEqual({
      blocking: 1,
      warnings: 1,
      major: 1,
      minor: 1,
      checks: 3,
      passedChecks: 1,
    });
    expect(roundLabel(failing)).toBe("Round 1 · 2 failed");
    expect(roundLabel({ ...failing, checks: [], findings: [] })).toBe(
      "Round 1 · no Checks",
    );
    expect(roundLabel({ ...failing, round: 3, passed: true })).toBe(
      "Round 3 · passed",
    );
  });
});

describe("slideIndexFor", () => {
  it("maps a plan id to the first slide laid out from it", () => {
    expect(slideIndexFor(deck, "p2")).toBe(1);
    expect(slideIndexFor(deck, "p9")).toBeNull();
    expect(slideIndexFor(deck, null)).toBeNull();
    expect(slideName(deck, "p1")).toBe("Slide 1");
    expect(slideName(deck, "s4")).toBe("s4");
  });
});

describe("maxRounds", () => {
  it("reads the Rule's Parameter", () => {
    expect(maxRounds(resolveRules())).toBe(3);
    expect(maxRounds([])).toBeNull();
  });
});

describe("roundDiff", () => {
  const checks = (failed: string[], all: string[]) =>
    all.map((ruleId) => ({
      ruleId,
      severity: "block" as const,
      passed: !failed.includes(ruleId),
      summary: "",
      failures: [],
    }));
  it("sorts failing Rules into fixed, still and new", () => {
    const all = ["a", "b", "c", "d"];
    expect(
      roundDiff(
        { checks: checks(["a", "b"], all) },
        { checks: checks(["b", "c"], all) },
      ),
    ).toEqual({ fixed: ["a"], still: ["b"], fresh: ["c"] });
    expect(roundDiff(null, { checks: checks(["d"], all) })).toEqual({
      fixed: [],
      still: [],
      fresh: ["d"],
    });
  });
});

describe("redoWarning", () => {
  it("names what a Redo replaces, and asks nothing when there is no verdict", () => {
    expect(redoWarning({ status: "approved", round: 2 })).toBe(
      "This replaces the approved Deck of Round 2 and calls the models again.",
    );
    expect(redoWarning({ status: "held", round: 3 })).toBe(
      "This replaces the Rounds of this Run and calls the models again.",
    );
    expect(redoWarning(null)).toBeNull();
  });
});

describe("firstRoundLine and emptyChecksLine", () => {
  const title = (id: string) => id.toUpperCase();
  it("says why a Round with no Checks was not approved", () => {
    expect(
      firstRoundLine({ passed: false, checks: [], findings: [] }, title),
    ).toBe(
      "No Deck Rules were on for this Round, so nothing could approve it.",
    );
    expect(emptyChecksLine([], true)).toBe(
      "No Deck Rules were on for this Round.",
    );
    expect(emptyChecksLine([], false)).toBe("Checking…");
    expect(emptyChecksLine([1], true)).toBeNull();
  });

  it("names the failing Rules, or the reviewer", () => {
    expect(firstRoundLine(failing, title)).toBe("2 Rules failed: A, B.");
    expect(
      firstRoundLine(
        {
          ...failing,
          checks: failing.checks.map((c) => ({ ...c, passed: true })),
        },
        title,
      ),
    ).toBe("The reviewer raised a major Finding.");
  });
});
