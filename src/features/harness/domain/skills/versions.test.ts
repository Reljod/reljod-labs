import { describe, expect, it } from "vitest";
import { defaultRuleState, type RuleSpec, renderRulebookMd } from "../rules";
import { SKILL_DEFAULTS, skillProblems } from "../skills";
import {
  changedParams,
  latestOf,
  nextScheduledRuleState,
  nextVersion,
  planRestore,
  resolveRuleAsOf,
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

  describe("as of a date", () => {
    const v = (
      version: number,
      effectiveFrom: string,
      extra: Partial<{ enabled: boolean; days: number }> = {},
    ) => ({
      version,
      enabled: extra.enabled ?? true,
      params: { days: extra.days ?? 30 },
      outcome: "block" as const,
      effectiveFrom,
    });

    it("names the next scheduled change, or none", () => {
      expect(
        nextScheduledRuleState(spec, [v(1, "2025-01-01")], "2026-11-17"),
      ).toBeNull();
      expect(
        nextScheduledRuleState(
          spec,
          [v(1, "2025-01-01", { days: 45 }), v(2, "2027-01-01", { days: 60 })],
          "2026-11-17",
        ),
      ).toMatchObject({ version: 2, effectiveFrom: "2027-01-01" });
    });

    it("lets a Version saved later with an earlier date replace an earlier-saved future one", () => {
      // Version 2 was saved for 1 March, then Version 3 for 1 February: from
      // 1 February Version 3 is in force, and on 1 March the highest Version
      // in effect is still 3, so Version 2 never applies.
      const versions = [
        v(1, "2025-01-01", { days: 45 }),
        v(2, "2027-03-01", { days: 60 }),
        v(3, "2027-02-01", { days: 50 }),
      ];
      expect(
        nextScheduledRuleState(spec, versions, "2026-11-17"),
      ).toMatchObject({ version: 3, effectiveFrom: "2027-02-01" });
      expect(resolveRuleAsOf(spec, versions, "2027-03-01")).toMatchObject({
        version: 3,
      });
      expect(nextScheduledRuleState(spec, versions, "2027-02-01")).toBeNull();
    });

    it("schedules nothing from a future Version below the one in force", () => {
      const versions = [v(1, "2027-01-01"), v(2, "2025-01-01", { days: 45 })];
      expect(nextScheduledRuleState(spec, versions, "2026-11-17")).toBeNull();
    });

    it("schedules the Default of a Rule not yet in force", () => {
      const later = { ...spec, effectiveFrom: "2027-06-01" };
      expect(resolveRuleAsOf(later, [], "2026-11-17")).toBeNull();
      expect(nextScheduledRuleState(later, [], "2026-11-17")).toMatchObject({
        version: 0,
        effectiveFrom: "2027-06-01",
      });
    });

    it("keeps the current Version while an edit is scheduled for later", () => {
      const versions = [
        v(1, "2025-01-01", { days: 45 }),
        v(2, "2027-01-01", { days: 60 }),
      ];
      const state = resolveRuleAsOf(spec, versions, "2026-11-17");
      expect(state).toMatchObject({ version: 1, params: { days: 45 } });
      expect(resolveRuleAsOf(spec, versions, "2027-01-01")).toMatchObject({
        version: 2,
        params: { days: 60 },
      });
    });

    it("keeps the Default while the only edit is scheduled for later", () => {
      const state = resolveRuleAsOf(
        spec,
        [v(1, "2027-01-01", { days: 60 })],
        "2026-11-17",
      );
      expect(state).toEqual(defaultRuleState(spec));
    });

    it("applies an edit dated today", () => {
      const state = resolveRuleAsOf(
        spec,
        [v(1, "2026-11-17", { days: 60 })],
        "2026-11-17",
      );
      expect(state).toMatchObject({ version: 1, params: { days: 60 } });
    });

    it("applies a restore, which is a new Version dated as the Default", () => {
      const versions = [
        v(1, "2026-01-01", { days: 60 }),
        v(2, spec.effectiveFrom),
      ];
      expect(resolveRuleAsOf(spec, versions, "2026-11-17")).toMatchObject({
        version: 2,
        params: { days: 30 },
      });
    });

    it("returns a switched-off Version in force as it is, for the caller to skip", () => {
      const state = resolveRuleAsOf(
        spec,
        [v(1, "2025-01-01", { enabled: false })],
        "2026-11-17",
      );
      expect(state).toMatchObject({ version: 1, enabled: false });
    });

    it("is null when even the Default is not yet in force", () => {
      expect(resolveRuleAsOf(spec, [], "2023-12-31")).toBeNull();
      expect(resolveRuleAsOf(spec, [], "2024-01-01")).toEqual(
        defaultRuleState(spec),
      );
    });
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
