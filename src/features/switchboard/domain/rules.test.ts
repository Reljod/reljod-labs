import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULEBOOK,
  RULE_IDS,
  RULES,
  type RuleVersionRow,
  resolveRulebook,
  ruleDefinition,
  ruleOf,
  validateRuleEdit,
} from "./rules";

const row = (
  ruleId: string,
  version: number,
  params: Record<string, unknown>,
  enabled = true,
): RuleVersionRow => ({
  ruleId,
  version,
  enabled,
  params,
  note: null,
  createdAt: "2026-11-19T10:00:00Z",
});

describe("RULES", () => {
  it("defines every id in RULE_IDS, once, in the same order", () => {
    expect(RULES.map((rule) => rule.id)).toEqual([...RULE_IDS]);
    for (const id of RULE_IDS) expect(ruleDefinition(id)?.id).toBe(id);
  });

  it("has defaults that pass its own validation", () => {
    for (const rule of RULES) {
      const checked = validateRuleEdit(rule.id, {
        enabled: true,
        params: rule.defaults,
      });
      expect(checked, rule.id).toMatchObject({ ok: true });
    }
  });

  it("names every placeholder in the sentence as a Parameter", () => {
    for (const rule of RULES) {
      for (const [, name] of rule.sentence.matchAll(/\{(\w+)\}/g)) {
        if (name === "requiresDisruptionText") continue;
        expect(rule.params, `${rule.id} {${name}}`).toHaveProperty(name);
      }
    }
  });

  it("does not know an unknown id", () => {
    expect(ruleDefinition("nope")).toBeUndefined();
  });
});

describe("resolveRulebook", () => {
  it("gives every Rule its Default as Version 1, switched on", () => {
    const book = resolveRulebook([]);
    expect(book.map((rule) => rule.id)).toEqual([...RULE_IDS]);
    for (const rule of book) {
      expect(rule.version).toBe(1);
      expect(rule.enabled).toBe(true);
      expect(rule.params).toEqual(ruleDefinition(rule.id)?.defaults);
    }
    expect(DEFAULT_RULEBOOK).toEqual(book);
  });

  it("lets a stored Version override the Default", () => {
    const book = resolveRulebook([
      row("goodwill.limits", 2, { maxPerCall: 50, requiresDisruption: false }),
    ]);
    const goodwill = ruleOf(book, "goodwill.limits");
    expect(goodwill.version).toBe(2);
    expect(goodwill.params).toEqual({
      maxPerCall: 50,
      requiresDisruption: false,
    });
    expect(ruleOf(book, "refund.limits").version).toBe(1);
  });

  it("takes the highest Version, whatever order the rows come in", () => {
    const book = resolveRulebook([
      row("goodwill.limits", 3, { maxPerCall: 30 }),
      row("goodwill.limits", 5, { maxPerCall: 10 }),
      row("goodwill.limits", 4, { maxPerCall: 40 }),
    ]);
    const goodwill = ruleOf(book, "goodwill.limits");
    expect(goodwill.version).toBe(5);
    expect(goodwill.params.maxPerCall).toBe(10);
    // A Parameter the edit left out keeps its Default.
    expect(goodwill.params.requiresDisruption).toBe(true);
  });

  it("carries a switched-off Rule", () => {
    const book = resolveRulebook([row("topics.refused", 2, {}, false)]);
    expect(ruleOf(book, "topics.refused")).toMatchObject({
      version: 2,
      enabled: false,
    });
  });

  it("falls back to the Default when the latest stored Version no longer fits", () => {
    const book = resolveRulebook([
      row("goodwill.limits", 2, { maxPerCall: 9999 }),
    ]);
    expect(ruleOf(book, "goodwill.limits")).toMatchObject({
      version: 1,
      enabled: true,
      params: { maxPerCall: 25, requiresDisruption: true },
    });
  });

  it("ignores rows of Rules that do not exist", () => {
    expect(resolveRulebook([row("ghost.rule", 9, {})])).toEqual(
      DEFAULT_RULEBOOK,
    );
  });
});

describe("ruleOf", () => {
  it("returns the Default for a Rule missing from an old snapshot", () => {
    const old = DEFAULT_RULEBOOK.filter((rule) => rule.id !== "call.length");
    expect(ruleOf(old, "call.length")).toEqual({
      id: "call.length",
      version: 1,
      enabled: true,
      params: { maxMinutes: 4 },
    });
  });
});

describe("validateRuleEdit", () => {
  const errorsOf = (
    ruleId: string,
    params: unknown,
    enabled: unknown = true,
  ) => {
    const checked = validateRuleEdit(ruleId, { enabled, params });
    return checked.ok ? [] : checked.errors;
  };
  const fieldsOf = (ruleId: string, params: unknown, enabled: unknown = true) =>
    errorsOf(ruleId, params, enabled).map((error) => error.field);

  it("accepts a good edit and cleans it", () => {
    const checked = validateRuleEdit("human.required", {
      enabled: false,
      params: { maxRefund: 150, topics: ["  injur*|hurt  ", "lawyer"] },
    });
    expect(checked).toEqual({
      ok: true,
      enabled: false,
      params: { maxRefund: 150, topics: ["injur*|hurt", "lawyer"] },
    });
  });

  it("fills Parameters the edit leaves out with their Defaults", () => {
    const checked = validateRuleEdit("refund.limits", {
      enabled: true,
      params: { delayPercent: 25 },
    });
    expect(checked).toEqual({
      ok: true,
      enabled: true,
      params: { minDelayMinutes: 60, delayPercent: 25, cancelPercent: 100 },
    });
  });

  it("rounds a number to two decimals", () => {
    const checked = validateRuleEdit("goodwill.limits", {
      enabled: true,
      params: { maxPerCall: 12.344 },
    });
    expect(checked.ok && checked.params.maxPerCall).toBe(12.34);
  });

  it("de-duplicates a multiple choice", () => {
    const checked = validateRuleEdit("identity.verify", {
      enabled: true,
      params: { factors: ["postcode", "postcode", "email"] },
    });
    expect(checked.ok && checked.params.factors).toEqual(["postcode", "email"]);
  });

  it("refuses an unknown Rule", () => {
    expect(validateRuleEdit("nope", { enabled: true, params: {} })).toEqual({
      ok: false,
      errors: [{ field: "rule", message: "No such Rule." }],
    });
  });

  it("refuses a switch that is not a boolean", () => {
    expect(fieldsOf("call.length", {}, "yes")).toEqual(["enabled"]);
  });

  it("refuses a Parameter the Rule does not have", () => {
    const errors = errorsOf("call.length", { maxHours: 2 });
    expect(errors).toEqual([
      { field: "maxHours", message: 'This Rule has no "maxHours".' },
    ]);
  });

  it("refuses a number that is not a number", () => {
    expect(fieldsOf("goodwill.limits", { maxPerCall: "25" })).toEqual([
      "maxPerCall",
    ]);
    expect(fieldsOf("goodwill.limits", { maxPerCall: Number.NaN })).toEqual([
      "maxPerCall",
    ]);
    expect(
      fieldsOf("goodwill.limits", { maxPerCall: Number.POSITIVE_INFINITY }),
    ).toEqual(["maxPerCall"]);
  });

  it("refuses a number out of range, naming the range and unit", () => {
    const [error] = errorsOf("goodwill.limits", { maxPerCall: 201 });
    expect(error.field).toBe("maxPerCall");
    expect(error.message).toContain("between 0 and 200 MRD");
    expect(fieldsOf("goodwill.limits", { maxPerCall: -1 })).toEqual([
      "maxPerCall",
    ]);
    expect(fieldsOf("call.length", { maxMinutes: 6 })).toEqual(["maxMinutes"]);
    expect(fieldsOf("call.length", { maxMinutes: 5 })).toEqual([]);
  });

  it("refuses a boolean that is not a boolean", () => {
    expect(fieldsOf("goodwill.limits", { requiresDisruption: "true" })).toEqual(
      ["requiresDisruption"],
    );
  });

  it("refuses a bad multiple choice", () => {
    expect(fieldsOf("identity.verify", { factors: "postcode" })).toEqual([
      "factors",
    ]);
    expect(fieldsOf("identity.verify", { factors: ["retina"] })).toEqual([
      "factors",
    ]);
    expect(fieldsOf("identity.verify", { factors: [7] })).toEqual(["factors"]);
    // identity.verify needs at least one factor; topics.refused may be empty.
    expect(fieldsOf("identity.verify", { factors: [] })).toEqual(["factors"]);
    expect(fieldsOf("topics.refused", { topics: [] })).toEqual([]);
  });

  it("refuses bad phrases", () => {
    expect(fieldsOf("disclosure.recording", { listenFor: "recorded" })).toEqual(
      ["listenFor"],
    );
    expect(fieldsOf("disclosure.recording", { listenFor: [] })).toEqual([
      "listenFor",
    ]);
    expect(
      fieldsOf("disclosure.recording", { listenFor: ["recorded", "  "] }),
    ).toEqual(["listenFor"]);
    expect(
      fieldsOf("disclosure.recording", { listenFor: ["recorded", 3] }),
    ).toEqual(["listenFor"]);
    expect(
      fieldsOf("disclosure.recording", {
        listenFor: ["a", "b", "c", "d", "e", "f", "g"],
      }),
    ).toEqual(["listenFor"]);
    expect(
      fieldsOf("disclosure.recording", { listenFor: ["x".repeat(201)] }),
    ).toEqual(["listenFor"]);
  });

  it("refuses bad text", () => {
    expect(fieldsOf("disclosure.refund", { say: "   " })).toEqual(["say"]);
    expect(fieldsOf("disclosure.refund", { say: 42 })).toEqual(["say"]);
    expect(fieldsOf("disclosure.refund", { say: "x".repeat(241) })).toEqual([
      "say",
    ]);
    expect(fieldsOf("disclosure.refund", { say: "x".repeat(240) })).toEqual([]);
  });

  it("reports every error at once", () => {
    expect(
      fieldsOf(
        "refund.limits",
        { delayPercent: 101, cancelPercent: "all", bogus: 1 },
        1,
      ).sort(),
    ).toEqual(["bogus", "cancelPercent", "delayPercent", "enabled"]);
  });
});
