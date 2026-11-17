import { describe, expect, it } from "vitest";
import { defaultRuleState, type RuleSpec, renderRulebookMd } from "../rules";
import { SKILL_DEFAULTS, skillProblems } from "../skills";
import {
  changedParams,
  latestOf,
  nextVersion,
  planRestore,
  resolveRuleState,
  sameRuleState,
} from "./versions";

const spec: RuleSpec = {
  id: "t.notice",
  pipelineId: "member_request",
  stepId: "check",
  title: "Notice period",
  sentence: "Notice of {days} is given.",
  params: { days: { kind: "days", label: "Notice", min: 1, max: 90 } },
  defaults: { days: 30 },
  defaultOutcome: "block",
  citation: "Plan rules, s. 4",
  effectiveFrom: "2024-01-01",
};

describe("versions", () => {
  it("numbers the next Version after the highest", () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([1, 3, 2])).toBe(4);
  });

  it("takes the latest Version, or none", () => {
    expect(latestOf([])).toBeNull();
    expect(latestOf([{ version: 1 }, { version: 3 }, { version: 2 }])).toEqual({
      version: 3,
    });
  });
});

describe("planRestore", () => {
  const base = { text: "default" };
  const saved = [
    { text: "one", version: 1 },
    { text: "two", version: 2 },
  ];

  it("puts the Default back as a new state when no Version is named", () => {
    expect(planRestore(base, saved)).toEqual({
      state: base,
      from: null,
      note: "Restored the Default",
    });
    expect(planRestore(base, saved, 0)?.from).toBeNull();
  });

  it("copies an earlier Version", () => {
    const plan = planRestore(base, saved, 1);
    expect(plan?.state).toEqual({ text: "one", version: 1 });
    expect(plan?.from).toBe(1);
    expect(plan?.note).toBe("Restored Version 1");
  });

  it("refuses a Version that was never saved", () => {
    expect(planRestore(base, saved, 9)).toBeNull();
  });
});

describe("Rule state resolution", () => {
  it("is the Default, Version 0, while nothing is saved", () => {
    expect(resolveRuleState(spec, null)).toEqual(defaultRuleState(spec));
  });

  it("is the latest saved Version, ignoring Parameters the spec dropped", () => {
    const state = resolveRuleState(spec, {
      version: 3,
      enabled: false,
      params: { days: 45, gone: 1 },
      outcome: "warn",
      effectiveFrom: "2025-02-01",
    });
    expect(state).toEqual({
      version: 3,
      enabled: false,
      params: { days: 45 },
      outcome: "warn",
      effectiveFrom: "2025-02-01",
    });
  });

  it("fills a Parameter a saved Version lacks from the Default", () => {
    const state = resolveRuleState(spec, {
      version: 1,
      enabled: true,
      params: {},
      outcome: "block",
      effectiveFrom: "2024-01-01",
    });
    expect(state.params).toEqual({ days: 30 });
  });

  it("compares states and lists what changed", () => {
    const base = defaultRuleState(spec);
    const next = { ...base, params: { days: 45 } };
    expect(sameRuleState(spec, base, { ...base })).toBe(true);
    expect(sameRuleState(spec, base, next)).toBe(false);
    expect(changedParams(spec, base.params, next.params)).toEqual({
      days: [30, 45],
    });
  });
});

describe("the Default Skills", () => {
  const ids = Object.keys(SKILL_DEFAULTS);

  it("ships the ids the app and the Pipelines expect", () => {
    expect(ids).toEqual([
      "member-request",
      "member-request-rules",
      "contribution-processing",
      "contribution-processing-rules",
      "delinquency-report",
      "delinquency-report-rules",
      "member-service-answer",
      "knowledge-filing",
      "desk-conventions",
      "sandbox-analysis",
    ]);
  });

  it("passes its own validation", () => {
    for (const skill of Object.values(SKILL_DEFAULTS)) {
      expect(skillProblems(skill), skill.id).toEqual([]);
      expect(skill.name, skill.id).toBe(skill.id);
    }
  });

  it("names the Pipeline tool each Pipeline Skill runs", () => {
    for (const [id, tool] of [
      ["member-request", "pipeline_member_request"],
      ["contribution-processing", "pipeline_contribution_processing"],
      ["delinquency-report", "pipeline_delinquency_report"],
    ] as const) {
      expect(SKILL_DEFAULTS[id]?.body).toContain(tool);
      expect(SKILL_DEFAULTS[id]?.description).toContain(tool);
    }
  });

  it("makes every Rulebook a Skill of its Pipeline", () => {
    for (const id of ids.filter((value) => value.endsWith("-rules"))) {
      expect(SKILL_DEFAULTS[id]?.kind).toBe("rulebook");
      expect(SKILL_DEFAULTS[id]?.pipelineId).toBeTruthy();
    }
  });

  it("never lets the Agent approve", () => {
    expect(SKILL_DEFAULTS["desk-conventions"]?.body).toMatch(
      /never give an Approval/,
    );
  });
});

describe("a Rulebook body", () => {
  it("is always rendered from the Rules in force, not stored", () => {
    const pipeline = {
      id: "member_request" as const,
      title: "Member request",
      steps: [
        {
          id: "check",
          title: "Check",
          kind: "code" as const,
          after: [],
          summary: "",
        },
      ],
    };
    const base = { spec, state: defaultRuleState(spec) };
    const edited = {
      spec,
      state: { ...base.state, version: 2, params: { days: 45 } },
    };
    expect(renderRulebookMd(pipeline, [base])).toContain("30 days");
    const text = renderRulebookMd(pipeline, [edited]);
    expect(text).toContain("45 days");
    expect(text).toContain("Version 2");
  });
});
