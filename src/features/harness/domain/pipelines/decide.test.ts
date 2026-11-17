import { describe, expect, it } from "vitest";
import type { Outcome } from "../rules";
import type { FindingDraft } from "./apply";
import { decideMemberRequest } from "./decide";
import { reconcile } from "./reconcile";

const finding = (
  ruleId: string,
  met: boolean,
  outcome: Outcome,
): FindingDraft => ({
  ruleId,
  ruleVersion: 0,
  stepId: "check_eligibility",
  met,
  outcome,
  summary: `${ruleId} ${met ? "met" : "not met"}`,
  compared: {},
});

describe("decideMemberRequest", () => {
  const base = { kind: "cessation_of_residence" as const, memberFound: true };
  it("proceeds when every Rule is met, warnings or not", () => {
    const result = decideMemberRequest({
      ...base,
      findings: [finding("a", true, "block"), finding("b", false, "warn")],
    });
    expect(result.decision).toBe("proceed");
    expect(result.warnings).toEqual(["b"]);
  });
  it("rejects on any unmet block, even with refers", () => {
    const result = decideMemberRequest({
      ...base,
      findings: [finding("a", false, "refer"), finding("b", false, "block")],
    });
    expect(result.decision).toBe("reject");
    expect(result.blocking).toEqual(["b"]);
    expect(result.referred).toEqual(["a"]);
  });
  it("asks for papers on an unmet refer", () => {
    expect(
      decideMemberRequest({ ...base, findings: [finding("a", false, "refer")] })
        .decision,
    ).toBe("request_documents");
  });
  it("does not proceed without a kind or a Member", () => {
    expect(
      decideMemberRequest({ ...base, kind: null, findings: [] }).decision,
    ).toBe("request_documents");
    const noMember = decideMemberRequest({
      ...base,
      memberFound: false,
      findings: [],
    });
    expect(noMember.decision).toBe("request_documents");
    expect(noMember.reasons[0]).toMatch(/No Member record/);
  });
  it("obeys the Outcome a Workspace set, not the Rule's default", () => {
    expect(
      decideMemberRequest({ ...base, findings: [finding("a", false, "warn")] })
        .decision,
    ).toBe("proceed");
  });
});

describe("reconcile", () => {
  const lines = [
    {
      line: 1,
      memberNo: "HB-1",
      memberName: "A",
      earningsKyd: 1000,
      employeeKyd: 50,
      employerKyd: 50,
      voluntaryKyd: 10,
    },
    {
      line: 2,
      memberNo: "HB-2",
      memberName: "B",
      earningsKyd: 2000,
      employeeKyd: 100,
      employerKyd: 80,
      voluntaryKyd: 0,
    },
  ];
  it("totals the Schedule and posts when nothing bites", () => {
    const result = reconcile({
      lines,
      findings: [finding("x", false, "warn")],
      receivedKyd: 290,
      readProblems: [],
    });
    expect(result.decision).toBe("post");
    expect(result.totals).toMatchObject({
      lines: 2,
      employeeKyd: 150,
      employerKyd: 130,
      voluntaryKyd: 10,
      totalKyd: 290,
      differenceKyd: 0,
    });
    expect(result.warnings).toHaveLength(1);
  });
  it("holds with one exception row per problem line", () => {
    const rate: FindingDraft = {
      ...finding("cp.employer-rate", false, "refer"),
      compared: {
        lines: [
          { line: 2, memberNo: "HB-2", memberName: "B", detail: "short" },
        ],
      },
    };
    const result = reconcile({
      lines,
      findings: [rate],
      receivedKyd: 290,
      readProblems: [],
    });
    expect(result.decision).toBe("hold");
    expect(result.exceptions).toEqual([
      {
        line: 2,
        memberNo: "HB-2",
        memberName: "B",
        detail: "short",
        ruleId: "cp.employer-rate",
        outcome: "refer",
      },
    ]);
  });
  it("holds when lines could not be read", () => {
    expect(
      reconcile({
        lines,
        findings: [],
        receivedKyd: 290,
        readProblems: ["Line 3 …"],
      }).decision,
    ).toBe("hold");
  });
});
