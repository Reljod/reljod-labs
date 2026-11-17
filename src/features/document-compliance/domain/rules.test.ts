import { describe, expect, it } from "vitest";
import {
  applyRuleEdit,
  defaultRuleState,
  isDefaultState,
  parseAppliedRules,
  RULE_SPECS,
  resolveRulebook,
  rulebookFromApplied,
  ruleSentence,
  ruleSpec,
  storedRuleState,
} from "./rules";

describe("Rule specs", () => {
  it("name every Parameter their sentence uses, and nothing else", () => {
    for (const spec of RULE_SPECS) {
      const slots = [...spec.sentence.matchAll(/\{(\w+)\}/g)].map(
        (match) => match[1],
      );
      expect(slots.sort()).toEqual(Object.keys(spec.params).sort());
      expect(Object.keys(spec.defaults).sort()).toEqual(
        Object.keys(spec.params).sort(),
      );
    }
  });

  it("ship Defaults their own checks accept", () => {
    for (const spec of RULE_SPECS) {
      const result = applyRuleEdit(spec, defaultRuleState(spec), {
        params: spec.defaults,
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe("applyRuleEdit", () => {
  const recent = ruleSpec("proof-of-address-recent");
  const confidence = ruleSpec("field-confidence");
  const certification = ruleSpec("certification-complete");

  it("saves a value inside the range", () => {
    const result = applyRuleEdit(recent, defaultRuleState(recent), {
      params: { maxAgeMonths: 6 },
    });
    expect(result).toEqual({
      ok: true,
      next: { enabled: true, params: { maxAgeMonths: 6 } },
    });
  });

  it.each([
    [{ maxAgeMonths: 0 }, "from 1 to 12"],
    [{ maxAgeMonths: 2.5 }, "whole number"],
    [{ maxAgeMonths: "3" }, "whole number"],
    [{ ageMonths: 3 }, "Unknown Parameter"],
  ])("refuses %j", (params, message) => {
    const result = applyRuleEdit(recent, defaultRuleState(recent), { params });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toContain(message);
  });

  it("keeps a percentage on its step and rounds it", () => {
    const state = defaultRuleState(confidence);
    expect(
      applyRuleEdit(confidence, state, { params: { minConfidence: 0.62 } }).ok,
    ).toBe(false);
    expect(
      applyRuleEdit(confidence, state, {
        params: { minConfidence: 0.1 + 0.2 + 0.4 },
      }),
    ).toEqual({
      ok: true,
      next: { enabled: true, params: { minConfidence: 0.7 } },
    });
  });

  it("refuses to switch off a Rule every check needs", () => {
    const result = applyRuleEdit(confidence, defaultRuleState(confidence), {
      enabled: false,
    });
    expect(result.ok).toBe(false);
  });

  it("orders a list as listed, once each, and needs at least one item", () => {
    const state = defaultRuleState(certification);
    expect(
      applyRuleEdit(certification, state, {
        params: { requiredParts: ["signature", "wording", "wording"] },
      }),
    ).toEqual({
      ok: true,
      next: {
        enabled: true,
        params: { requiredParts: ["wording", "signature"] },
      },
    });
    expect(
      applyRuleEdit(certification, state, { params: { requiredParts: [] } }).ok,
    ).toBe(false);
    expect(
      applyRuleEdit(certification, state, {
        params: { requiredParts: ["stamp"] },
      }).ok,
    ).toBe(false);
  });
});

describe("stored Rules", () => {
  it("fall back to the Default for a value the Rule can no longer hold", () => {
    const spec = ruleSpec("proof-of-address-recent");
    expect(
      storedRuleState(spec, {
        version: 4,
        enabled: true,
        params: { maxAgeMonths: 99 },
      }),
    ).toEqual({ ...defaultRuleState(spec), version: 4 });
  });

  it("drop Parameters the Rule no longer has", () => {
    const spec = ruleSpec("proof-of-address-recent");
    const state = storedRuleState(spec, {
      version: 2,
      enabled: false,
      params: { maxAgeMonths: 2, retired: true },
    });
    expect(state).toEqual({
      version: 2,
      enabled: false,
      params: { maxAgeMonths: 2 },
    });
    expect(isDefaultState(spec, state)).toBe(false);
  });

  it("rebuild the Rulebook a run applied, and the Defaults for an old run", () => {
    const states = {
      "proof-of-address-recent": {
        version: 3,
        enabled: true,
        params: { maxAgeMonths: 1 },
      },
    };
    const rulebook = resolveRulebook(states);
    const applied = parseAppliedRules(
      JSON.parse(JSON.stringify(rulebook.applied)),
    );
    expect(rulebookFromApplied(applied)).toEqual(rulebook);
    expect(
      rulebook.requirements.find(
        (item) => item.id === "proof-of-address-recent",
      )?.title,
    ).toBe("Proof of address is dated within 1 month");
    expect(rulebookFromApplied(null)).toEqual(resolveRulebook({}));
    expect(parseAppliedRules("nope")).toBeNull();
  });
});

describe("ruleSentence", () => {
  it("writes each Parameter in its sentence", () => {
    expect(
      ruleSentence(ruleSpec("certification-complete"), {
        requiredParts: ["wording", "date", "signature"],
      }),
    ).toBe(
      "The certified copy carries the certification wording, certification date and signature.",
    );
    expect(ruleSentence(ruleSpec("name-matches"), { onMismatch: "fail" })).toBe(
      "Every document names the declared client; a name that differs is marked Fail.",
    );
  });
});
