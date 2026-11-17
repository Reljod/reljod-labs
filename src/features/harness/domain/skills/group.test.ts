import { describe, expect, it } from "vitest";
import { defaultRuleState, type RuleSpec, type RuleView } from "../rules";
import { groupRulesByStep, ruleSummary } from "./group";

const view = (
  id: string,
  stepId: string,
  patch: Partial<RuleView> = {},
): RuleView => {
  const spec: RuleSpec = {
    id,
    pipelineId: "member_request",
    stepId,
    title: id,
    sentence: "x",
    params: {},
    defaults: {},
    defaultOutcome: "block",
    citation: "c",
    effectiveFrom: "2024-01-01",
  };
  return {
    spec,
    state: defaultRuleState(spec),
    inForce: defaultRuleState(spec),
    scheduled: null,
    edited: false,
    savedBy: null,
    savedAt: null,
    ...patch,
  };
};

const step = (id: string, title: string) => ({
  id,
  title,
  kind: "code" as const,
  after: [],
  summary: "",
});

describe("groupRulesByStep", () => {
  const pipeline = {
    steps: [step("a", "First"), step("b", "Second"), step("c", "Third")],
  };

  it("follows the Pipeline's Step order and skips Steps with no Rule", () => {
    const groups = groupRulesByStep(pipeline, [
      view("r1", "c"),
      view("r2", "a"),
      view("r3", "a"),
    ]);
    expect(groups.map((g) => [g.title, g.rules.map((r) => r.spec.id)])).toEqual(
      [
        ["First", ["r2", "r3"]],
        ["Third", ["r1"]],
      ],
    );
  });

  it("keeps Rules of an unknown Step, and works with no Pipeline", () => {
    expect(
      groupRulesByStep(pipeline, [view("r1", "zzz")]).map((g) => g.title),
    ).toEqual(["zzz"]);
    expect(groupRulesByStep(null, [view("r1", "my_step")])[0]?.title).toBe(
      "my step",
    );
    expect(groupRulesByStep(pipeline, [])).toEqual([]);
  });
});

describe("ruleSummary", () => {
  it("counts Rules, edited and off", () => {
    const off = view("r2", "a");
    off.state = { ...off.state, enabled: false };
    expect(ruleSummary([view("r1", "a", { edited: true }), off])).toEqual({
      total: 2,
      edited: 1,
      off: 1,
    });
  });
});
