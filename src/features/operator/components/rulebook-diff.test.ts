import { describe, expect, it } from "vitest";
import {
  ACTION_KINDS,
  DEFAULT_RULEBOOK,
  type Rulebook,
  SCREEN_CODES,
} from "../domain/rules";
import {
  changedRules,
  diffSummary,
  firstProblem,
  nextVersion,
  sameRulebook,
  toggleIn,
  warningOf,
} from "./rulebook-diff";

const edit = (patch: Partial<Rulebook>): Rulebook => ({
  ...DEFAULT_RULEBOOK,
  ...patch,
});

describe("changedRules", () => {
  it("finds nothing between a Rulebook and itself", () => {
    expect(changedRules(DEFAULT_RULEBOOK, DEFAULT_RULEBOOK)).toEqual([]);
    expect(diffSummary([])).toBe("No change from the current version");
  });

  it("names each Rule whose switch or Parameters changed, in RULES order", () => {
    const draft = edit({
      signOff: { enabled: false },
      records: { enabled: true, max: 12 },
    });
    expect(changedRules(DEFAULT_RULEBOOK, draft)).toEqual([
      "records.max",
      "session.sign-off",
    ]);
    expect(diffSummary(changedRules(DEFAULT_RULEBOOK, draft))).toBe(
      "2 Rules changed",
    );
    expect(diffSummary(["records.max"])).toBe("1 Rule changed");
  });

  it("ignores the order of a list", () => {
    const draft = edit({
      guarded: {
        enabled: true,
        actions: [...DEFAULT_RULEBOOK.guarded.actions].reverse(),
      },
    });
    expect(sameRulebook(DEFAULT_RULEBOOK, draft)).toBe(true);
  });
});

describe("toggleIn", () => {
  it("adds and removes in the canonical order", () => {
    const on = toggleIn(["line.delete"], "vessel.register", ACTION_KINDS);
    expect(on).toEqual(["vessel.register", "line.delete"]);
    expect(toggleIn(on, "vessel.register", ACTION_KINDS)).toEqual([
      "line.delete",
    ]);
  });
});

describe("firstProblem", () => {
  it("passes the Default", () => {
    expect(firstProblem(DEFAULT_RULEBOOK)).toBeNull();
  });

  it("names the Rule and the range of a bad record cap", () => {
    for (const max of [0, 201, 2.5, Number.NaN]) {
      expect(firstProblem(edit({ records: { enabled: true, max } }))).toMatch(
        /^Records per Run: enter a whole number from 1 to 200\.$/,
      );
    }
  });
});

describe("warningOf", () => {
  it("warns when the main menu is off the Screen list, only while the Rule is on", () => {
    const allowed = SCREEN_CODES.filter((code) => code !== "HMM100");
    expect(warningOf(edit({ screens: { enabled: true, allowed } }))).toMatch(
      /HMM100/,
    );
    expect(warningOf(edit({ screens: { enabled: false, allowed } }))).toBe(
      null,
    );
    expect(warningOf(DEFAULT_RULEBOOK)).toBeNull();
  });
});

describe("nextVersion", () => {
  it("is one past the highest version, and 1 when only the Default exists", () => {
    const at = (version: number) => ({
      version,
      rulebook: DEFAULT_RULEBOOK,
      note: null,
      createdAt: null,
    });
    expect(nextVersion([at(0)])).toBe(1);
    expect(nextVersion([at(4), at(3), at(0)])).toBe(5);
    expect(nextVersion([])).toBe(1);
  });
});
