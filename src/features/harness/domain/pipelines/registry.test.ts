import { describe, expect, it } from "vitest";
import { levels, pipelineProblems } from "../pipeline";
import { RULE_SPECS } from "../rules/defaults";
import { CONTRIBUTION_CHECKS } from "./checks/contribution";
import { DELINQUENCY_CHECKS } from "./checks/delinquency";
import { MEMBER_REQUEST_CHECKS } from "./checks/member-request";
import { isIsoDate } from "./dates";
import { PIPELINES, pipelineOf, subjectOf } from "./index";
import { parseRunInput } from "./input";

const CHECKS: Record<string, Record<string, Record<string, unknown>>> = {
  member_request: MEMBER_REQUEST_CHECKS,
  contribution_processing: CONTRIBUTION_CHECKS,
  delinquency_report: DELINQUENCY_CHECKS,
};

describe("PIPELINES", () => {
  it("registers the three Pipelines with valid Step graphs, Skills and one Approval each", () => {
    expect(PIPELINES.map((pipeline) => pipeline.id)).toEqual([
      "member_request",
      "contribution_processing",
      "delinquency_report",
    ]);
    for (const pipeline of PIPELINES) {
      expect(pipelineProblems(pipeline)).toEqual([]);
      expect(pipeline.rulebookSkillId).toBe(`${pipeline.skillId}-rules`);
      expect(
        pipeline.steps
          .filter((step) => step.kind === "approval")
          .map((step) => step.id),
      ).toEqual(["approval"]);
    }
  });

  it("runs Steps side by side where the graph allows", () => {
    const ids = (id: string) =>
      levels(pipelineOf(id) as never).map((level) =>
        level.map((step) => step.id),
      );
    expect(ids("member_request")).toEqual([
      ["intake"],
      ["classify", "read_documents", "find_member"],
      [
        "check_identity",
        "check_eligibility",
        "check_documents",
        "check_deadline",
      ],
      ["decide"],
      ["draft"],
      ["approval"],
      ["record"],
    ]);
    expect(ids("contribution_processing")).toEqual([
      ["parse_schedule"],
      [
        "match_members",
        "check_rates",
        "check_cap",
        "check_coverage",
        "match_remittance",
      ],
      ["reconcile"],
      ["draft_query"],
      ["approval"],
      ["post"],
    ]);
    expect(ids("delinquency_report")).toEqual([
      ["load_period"],
      ["find_missing", "find_late"],
      ["compute"],
      ["draft_report", "draft_chasers"],
      ["approval"],
      ["file"],
    ]);
  });
});

describe("RULE_SPECS", () => {
  it("has 20 to 32 Rules with unique ids", () => {
    expect(RULE_SPECS.length).toBeGreaterThanOrEqual(20);
    expect(RULE_SPECS.length).toBeLessThanOrEqual(32);
    expect(new Set(RULE_SPECS.map((spec) => spec.id)).size).toBe(
      RULE_SPECS.length,
    );
  });

  it("puts every Rule on a code Step of its Pipeline, with a check, a citation and a real date", () => {
    for (const spec of RULE_SPECS) {
      const step = pipelineOf(spec.pipelineId)?.steps.find(
        (item) => item.id === spec.stepId,
      );
      expect(step?.kind, spec.id).toBe("code");
      expect(
        CHECKS[spec.pipelineId]?.[spec.stepId]?.[spec.id],
        spec.id,
      ).toBeTypeOf("function");
      expect(spec.citation.length, spec.id).toBeGreaterThan(10);
      expect(isIsoDate(spec.effectiveFrom), spec.id).toBe(true);
    }
  });

  it("has a Rule for every check", () => {
    const ids = new Set(RULE_SPECS.map((spec) => spec.id));
    for (const steps of Object.values(CHECKS)) {
      for (const checks of Object.values(steps)) {
        for (const id of Object.keys(checks))
          expect(ids.has(id), id).toBe(true);
      }
    }
  });

  it("says illustrative wherever no statute is cited", () => {
    for (const spec of RULE_SPECS) {
      if (!/Act|Regulations/.test(spec.citation))
        expect(spec.citation, spec.id).toMatch(/illustrative/);
    }
  });
});

describe("parseRunInput", () => {
  const id = "0b7d1e4a-7f7a-4a3e-9d0b-2a1c3e4f5a6b";
  it("takes Source ids as a list or a string, and drops repeats", () => {
    const parsed = parseRunInput(
      "member_request",
      { sourceIds: `${id}, ${id.toUpperCase()}` },
      "2026-11-17",
    );
    expect(parsed).toEqual({ ok: true, input: { sourceIds: [id] } });
  });
  it("caps the papers per Run", () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      id.replace(/b$/, String(index)),
    );
    expect(
      parseRunInput("member_request", { sourceIds: many }, "2026-11-17").ok,
    ).toBe(false);
  });
  it("refuses a month that has not ended", () => {
    expect(
      parseRunInput("delinquency_report", { period: "2026-11" }, "2026-11-17"),
    ).toMatchObject({ ok: false });
    expect(
      parseRunInput("delinquency_report", { period: "2026-10" }, "2026-11-17")
        .ok,
    ).toBe(true);
    expect(
      parseRunInput("delinquency_report", { period: "2026-13" }, "2026-11-17")
        .ok,
    ).toBe(false);
  });
  it("normalises a contribution input", () => {
    expect(
      parseRunInput(
        "contribution_processing",
        {
          sourceId: id,
          employerCode: "er-1001",
          overrideExceptions: "true",
          period: "",
        },
        "2026-11-17",
      ),
    ).toEqual({
      ok: true,
      input: {
        sourceId: id,
        employerCode: "ER-1001",
        overrideExceptions: true,
      },
    });
  });
});

describe("subjectOf", () => {
  it("names the Run by what it is about", () => {
    expect(subjectOf("member_request", { sourceIds: ["a", "b"] }, null)).toBe(
      "Member request · 2 papers",
    );
    expect(
      subjectOf(
        "member_request",
        {},
        { kind: "transfer_out", memberNo: "HB-10016" },
      ),
    ).toBe("Transfer out · HB-10016");
    expect(
      subjectOf(
        "contribution_processing",
        { employerCode: "ER-1001", period: "2026-10" },
        null,
      ),
    ).toBe("ER-1001 · October 2026");
    expect(subjectOf("delinquency_report", { period: "2026-09" }, null)).toBe(
      "Delinquency · September 2026",
    );
  });
});
