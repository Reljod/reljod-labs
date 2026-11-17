import { describe, expect, it } from "vitest";
import { defaultRuleState, type RuleSpec } from "../rules";
import {
  dateProblem,
  differsFromDefault,
  draftOfState,
  draftProblems,
  editOfDraft,
  isDirty,
  parseParamDraft,
  unitOf,
} from "./rule-fields";

const spec: RuleSpec = {
  id: "t.rule",
  pipelineId: "member_request",
  stepId: "s",
  title: "T",
  sentence: "{months} {ceiling} {method} {statuses}",
  params: {
    months: { kind: "months", label: "Time away", min: 1, max: 60 },
    ceiling: {
      kind: "money",
      label: "Ceiling",
      min: 0,
      max: 100000,
      step: 500,
    },
    method: {
      kind: "enum",
      label: "Method",
      options: [
        { value: "wire", label: "wire" },
        { value: "cheque", label: "cheque" },
      ],
    },
    statuses: {
      kind: "list",
      label: "Statuses",
      options: [
        { value: "pr", label: "PR" },
        { value: "status", label: "Status" },
      ],
      maxItems: 1,
    },
  },
  defaults: { months: 24, ceiling: 5000, method: "wire", statuses: ["pr"] },
  defaultOutcome: "block",
  citation: "c",
  effectiveFrom: "2024-01-01",
};

describe("parseParamDraft", () => {
  it("reads numbers, with commas and a CI$ prefix", () => {
    expect(parseParamDraft("ceiling", spec.params.ceiling!, "5,500")).toEqual({
      ok: true,
      value: 5500,
    });
    expect(parseParamDraft("ceiling", spec.params.ceiling!, "CI$6000")).toEqual(
      {
        ok: true,
        value: 6000,
      },
    );
  });

  it("says what is wrong where it was typed", () => {
    const empty = parseParamDraft("months", spec.params.months!, "");
    expect(empty.ok).toBe(false);
    const high = parseParamDraft("months", spec.params.months!, "61");
    expect(high).toMatchObject({ ok: false });
    expect(!high.ok && high.message).toMatch(/more than/);
    const fraction = parseParamDraft("months", spec.params.months!, "2.5");
    expect(!fraction.ok && fraction.message).toMatch(/whole number/);
    const step = parseParamDraft("ceiling", spec.params.ceiling!, "5100");
    expect(!step.ok && step.message).toMatch(/steps of 500/);
    expect(parseParamDraft("months", spec.params.months!, "abc").ok).toBe(
      false,
    );
  });

  it("checks enums and lists against their options and limits", () => {
    expect(parseParamDraft("method", spec.params.method!, "cash").ok).toBe(
      false,
    );
    expect(parseParamDraft("method", spec.params.method!, "cheque").ok).toBe(
      true,
    );
    expect(
      parseParamDraft("statuses", spec.params.statuses!, ["pr", "status"]).ok,
    ).toBe(false);
    expect(parseParamDraft("statuses", spec.params.statuses!, ["x"]).ok).toBe(
      false,
    );
  });
});

describe("a card's draft", () => {
  const state = defaultRuleState(spec);
  const base = draftOfState(spec, state);

  it("starts clean and not dirty", () => {
    expect(isDirty(spec, base, structuredClone(base))).toBe(false);
    expect(draftProblems(spec, base)).toEqual({});
  });

  it("sends only what changed, as typed values", () => {
    const draft = structuredClone(base);
    draft.params.months = "36";
    draft.outcome = "refer";
    expect(isDirty(spec, base, draft)).toBe(true);
    expect(editOfDraft(spec, base, draft)).toEqual({
      outcome: "refer",
      params: { months: 36 },
    });
  });

  it("leaves a field that does not parse out and reports it", () => {
    const draft = structuredClone(base);
    draft.params.months = "";
    expect(editOfDraft(spec, base, draft)).toEqual({});
    expect(draftProblems(spec, draft).months).toMatch(/give a number/);
  });

  it("notes what differs from the Default", () => {
    expect(differsFromDefault(spec, "months", "24")).toBe(false);
    expect(differsFromDefault(spec, "months", "12")).toBe(true);
    expect(differsFromDefault(spec, "statuses", ["pr"])).toBe(false);
    expect(differsFromDefault(spec, "statuses", [])).toBe(true);
  });
});

describe("helpers", () => {
  it("names units", () => {
    expect(unitOf(spec.params.ceiling!)).toEqual({ before: "CI$" });
    expect(unitOf(spec.params.months!)).toEqual({ after: "months" });
    expect(unitOf(spec.params.method!)).toEqual({});
  });

  it("checks dates", () => {
    expect(dateProblem("2025-02-28")).toBeNull();
    expect(dateProblem("2025-02-30")).toMatch(/real date/);
    expect(dateProblem("28/02/2025")).toMatch(/YYYY-MM-DD/);
  });
});
