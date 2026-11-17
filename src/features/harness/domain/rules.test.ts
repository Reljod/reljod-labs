import { describe, expect, it } from "vitest";
import {
  defaultRuleState,
  formatParameter,
  isDefaultState,
  listedRule,
  type RuleSpec,
  renderRulebookMd,
  renderRuleSentence,
  ruleSentenceText,
  validateRuleEdit,
} from "./rules";
import { RULE_SPECS } from "./rules/defaults";

const notice: RuleSpec = {
  id: "mr.left-cayman",
  pipelineId: "member_request",
  stepId: "eligibility",
  title: "Time away from Cayman",
  sentence:
    "The Member has been away for at least {months} with a balance of at most {ceiling}, paid by {method}, unless they hold {statuses}.",
  params: {
    months: { kind: "months", label: "Time away", min: 1, max: 60 },
    ceiling: {
      kind: "money",
      label: "Balance ceiling",
      min: 0,
      max: 100_000,
      step: 500,
    },
    method: {
      kind: "enum",
      label: "Payment method",
      options: [
        { value: "wire", label: "wire transfer" },
        { value: "cheque", label: "cheque" },
      ],
    },
    statuses: {
      kind: "list",
      label: "Exempt statuses",
      options: [
        { value: "pr", label: "permanent residence" },
        { value: "status", label: "Caymanian status" },
      ],
      maxItems: 2,
    },
  },
  defaults: { months: 24, ceiling: 5000, method: "wire", statuses: ["pr"] },
  defaultOutcome: "block",
  citation: "National Pensions Act, s. 52 (illustrative)",
  effectiveFrom: "2024-01-01",
};

describe("validateRuleEdit", () => {
  it("lays a good edit over the current state", () => {
    const result = validateRuleEdit(notice, {
      params: { months: 6 },
      outcome: "refer",
    });
    expect(result).toEqual({
      ok: true,
      next: {
        enabled: true,
        params: { months: 6, ceiling: 5000, method: "wire", statuses: ["pr"] },
        outcome: "refer",
        effectiveFrom: "2024-01-01",
      },
    });
  });

  it("builds on the state it is given, not the Default", () => {
    const current = {
      ...defaultRuleState(notice),
      enabled: false,
      params: { ...notice.defaults, months: 12 },
    };
    const result = validateRuleEdit(
      notice,
      { params: { ceiling: 10_000 } },
      current,
    );
    expect(result).toMatchObject({
      ok: true,
      next: { enabled: false, params: { months: 12, ceiling: 10_000 } },
    });
  });

  it("refuses values outside a Parameter's range, type, step or options", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ months: 0 }, "below_min"],
      [{ months: 61 }, "above_max"],
      [{ months: 2.5 }, "not_whole"],
      [{ months: "6" }, "wrong_type"],
      [{ months: Number.NaN }, "wrong_type"],
      [{ ceiling: 5250 }, "off_step"],
      [{ method: "cash" }, "not_an_option"],
      [{ method: 3 }, "wrong_type"],
      [{ statuses: "pr" }, "wrong_type"],
      [{ statuses: ["pr", "visitor"] }, "not_an_option"],
      [{ statuses: ["pr", "status", "pr"] }, "too_many"],
      [{ rate: 5 }, "unknown_parameter"],
    ];
    for (const [params, code] of cases) {
      const result = validateRuleEdit(notice, { params });
      expect(result.ok, JSON.stringify(params)).toBe(false);
      if (!result.ok) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ field: "params", code });
      }
    }
  });

  it("reports every field at fault at once", () => {
    const result = validateRuleEdit(notice, {
      params: { months: 0, ceiling: -1 },
      outcome: "ignore",
      effectiveFrom: "2026-02-30",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toEqual([
        "below_min",
        "below_min",
        "bad_outcome",
        "bad_date",
      ]);
      expect(result.errors[0]?.message).toBe(
        "Time away: cannot be less than 1 month.",
      );
    }
  });

  it("accepts a step measured from the minimum, and float steps", () => {
    const rate: RuleSpec = {
      ...notice,
      sentence: "Each side pays {rate}.",
      params: {
        rate: { kind: "percent", label: "Rate", min: 0.5, max: 10, step: 0.1 },
      },
      defaults: { rate: 5 },
    };
    expect(validateRuleEdit(rate, { params: { rate: 5.3 } }).ok).toBe(true);
    expect(validateRuleEdit(rate, { params: { rate: 5.35 } }).ok).toBe(false);
  });
});

describe("isDefaultState", () => {
  it("tells the Default from an edit, whatever the Version", () => {
    const base = defaultRuleState(notice);
    expect(isDefaultState(notice, base)).toBe(true);
    expect(isDefaultState(notice, { ...base, enabled: false })).toBe(false);
    expect(
      isDefaultState(notice, {
        ...base,
        params: { ...base.params, statuses: ["status"] },
      }),
    ).toBe(false);
  });
});

describe("renderRuleSentence", () => {
  it("splits the sentence into text and Parameters, in order", () => {
    const segments = renderRuleSentence(notice, notice.defaults);
    expect(segments.map((segment) => segment.type)).toEqual([
      "text",
      "param",
      "text",
      "param",
      "text",
      "param",
      "text",
      "param",
      "text",
    ]);
    expect(segments[1]).toMatchObject({
      name: "months",
      value: 24,
      text: "24 months",
    });
    expect(ruleSentenceText(notice, notice.defaults)).toBe(
      "The Member has been away for at least 24 months with a balance of at most CI$5,000, paid by wire transfer, unless they hold permanent residence.",
    );
  });

  it("leaves a slot that names no Parameter as text", () => {
    expect(
      renderRuleSentence(
        { sentence: "Wait {days} or {nothing}.", params: {} },
        {},
      ),
    ).toEqual([{ type: "text", text: "Wait {days} or {nothing}." }]);
  });

  it("starts and ends with a Parameter when the sentence does", () => {
    const spec = {
      sentence: "{days}",
      params: { days: { kind: "days" as const, label: "Days" } },
    };
    expect(renderRuleSentence(spec, { days: 1 })).toEqual([
      {
        type: "param",
        name: "days",
        spec: spec.params.days,
        value: 1,
        text: "1 day",
      },
    ]);
    expect(renderRuleSentence(spec, {})[0]).toMatchObject({ text: "…" });
  });
});

describe("formatParameter", () => {
  it("writes each kind the way a person reads it", () => {
    expect(formatParameter({ kind: "money", label: "" }, 1234.5)).toBe(
      "CI$1,234.5",
    );
    expect(formatParameter({ kind: "percent", label: "" }, 5)).toBe("5%");
    expect(formatParameter({ kind: "years", label: "" }, 1)).toBe("1 year");
    expect(
      formatParameter({ kind: "number", label: "", unit: "payments" }, 3),
    ).toBe("3 payments");
    expect(formatParameter({ kind: "list", label: "" }, [])).toBe("none");
  });
});

describe("renderRulebookMd", () => {
  const pipeline = {
    id: "member_request" as const,
    title: "Member request",
    steps: [
      {
        id: "identity",
        title: "Identity",
        kind: "code" as const,
        after: [],
        summary: "",
      },
      {
        id: "eligibility",
        title: "Eligibility",
        kind: "code" as const,
        after: ["identity"],
        summary: "",
      },
    ],
  };

  it("groups Rules by Step and writes each with its values, Outcome and source", () => {
    const text = renderRulebookMd(pipeline, [
      {
        spec: notice,
        state: { ...defaultRuleState(notice), version: 3, outcome: "refer" },
      },
      {
        spec: { ...notice, id: "other.rule", pipelineId: "delinquency_report" },
        state: defaultRuleState(notice),
      },
    ]);
    expect(text).toContain("# Rulebook: Member request");
    expect(text).toContain("## Eligibility\n\n### Time away from Cayman\n");
    expect(text).not.toContain("## Identity");
    expect(text).toContain("at least 24 months");
    expect(text).toContain(
      "- Rule: `mr.left-cayman` · Version 3 · in effect from 2024-01-01",
    );
    expect(text).toContain("- If not met: **refer** (a person must look)");
    expect(text).toContain(
      "- Source: National Pensions Act, s. 52 (illustrative)",
    );
    expect(text).not.toContain("other.rule");
  });

  it("renders the Version in force, not a later one saved for a future date, and names the scheduled change", () => {
    const inForce = {
      ...defaultRuleState(notice),
      version: 1,
      outcome: "refer" as const,
    };
    const scheduled = {
      ...inForce,
      version: 2,
      effectiveFrom: "2027-01-01",
      params: { ...inForce.params, months: 36 },
      outcome: "block" as const,
    };
    const text = renderRulebookMd(pipeline, [
      { spec: notice, state: scheduled, inForce, scheduled },
    ]);
    expect(text).toContain("at least 24 months");
    expect(text).not.toContain("at least 36 months");
    expect(text).toContain(
      "- Rule: `mr.left-cayman` · Version 1 · in effect from 2024-01-01",
    );
    expect(text).toContain("- If not met: **refer**");
    expect(text).toContain(
      "- Scheduled: Version 2 from 2027-01-01: Time away 24 months → 36 months; Outcome refer → block",
    );
    expect(text).toMatch(
      /highest wins, so a Version saved later with an earlier date replaces/,
    );
  });

  it("lists a Rule whose Default is not yet in force as not in force until its date", () => {
    const later = { ...notice, effectiveFrom: "2027-06-01" };
    const text = renderRulebookMd(pipeline, [
      {
        spec: later,
        state: defaultRuleState(later),
        inForce: null,
        scheduled: defaultRuleState(later),
      },
    ]);
    expect(text).toContain(
      "### Time away from Cayman (not in force until 2027-06-01)",
    );
    expect(text).toContain("a Run started before then does not check it");
    expect(text).not.toContain("- If not met:");
  });

  it("gives list_rules the state in force and the scheduled change explicitly", () => {
    const inForce = { ...defaultRuleState(notice), version: 1 };
    const scheduled = {
      ...inForce,
      version: 2,
      enabled: false,
      effectiveFrom: "2027-01-01",
    };
    const listed = listedRule({
      spec: notice,
      state: scheduled,
      inForce,
      scheduled,
      edited: true,
      savedBy: null,
      savedAt: null,
    });
    expect(listed.inForce).toMatchObject({
      version: 1,
      enabled: true,
      outcome: "block",
    });
    expect(listed.inForce?.rule).toContain("24 months");
    expect(listed.scheduled).toMatchObject({
      version: 2,
      effectiveFrom: "2027-01-01",
      enabled: false,
      changes: "switched off",
    });
    expect(
      listedRule({
        spec: notice,
        state: inForce,
        inForce: null,
        scheduled: null,
        edited: false,
        savedBy: null,
        savedAt: null,
      }).inForce,
    ).toBeNull();
  });

  it("says when a Rule is switched off or its Step is unknown, and when there are none", () => {
    const off = renderRulebookMd(pipeline, [
      {
        spec: { ...notice, stepId: "gone" },
        state: { ...defaultRuleState(notice), enabled: false },
      },
    ]);
    expect(off).toContain("## Other Rules");
    expect(off).toContain("### Time away from Cayman (switched off)");
    expect(off).toContain("· Default ·");
    expect(off).toContain("a Run does not check it");
    expect(renderRulebookMd(pipeline, [])).toContain("no Rules yet");
  });
});

describe("RULE_SPECS", () => {
  it("ships only Rules whose defaults pass their own schema and whose slots are Parameters", () => {
    for (const spec of RULE_SPECS) {
      expect(
        validateRuleEdit(spec, { params: spec.defaults }).ok,
        spec.id,
      ).toBe(true);
      expect(Object.keys(spec.defaults).sort()).toEqual(
        Object.keys(spec.params).sort(),
      );
      for (const segment of renderRuleSentence(spec, spec.defaults)) {
        if (segment.type === "text")
          expect(segment.text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});
