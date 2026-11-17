import { describe, expect, it } from "vitest";
import {
  findCycle,
  isPipelineId,
  levels,
  PipelineError,
  pipelineProblems,
  type StepSpec,
  upstream,
} from "./pipeline";
import { PIPELINES } from "./pipelines";

const step = (id: string, ...after: string[]): StepSpec => ({
  id,
  title: id,
  kind: "code",
  after,
  summary: "",
});

const ids = (grouped: StepSpec[][]) =>
  grouped.map((level) => level.map((item) => item.id));

describe("levels", () => {
  it("puts Steps that wait for nothing in the first level", () => {
    expect(ids(levels({ steps: [step("a"), step("b")] }))).toEqual([
      ["a", "b"],
    ]);
  });

  it("groups Steps that can run at the same time", () => {
    const steps = [
      step("load"),
      step("identity", "load"),
      step("eligibility", "load"),
      step("amount", "eligibility"),
      step("draft", "identity", "amount"),
      step("approve", "draft"),
    ];
    expect(ids(levels({ steps }))).toEqual([
      ["load"],
      ["identity", "eligibility"],
      ["amount"],
      ["draft"],
      ["approve"],
    ]);
  });

  it("does not depend on the order Steps are listed in", () => {
    expect(
      ids(levels({ steps: [step("c", "b"), step("b", "a"), step("a")] })),
    ).toEqual([["a"], ["b"], ["c"]]);
  });

  it("returns no levels for no Steps", () => {
    expect(levels({ steps: [] })).toEqual([]);
  });

  it("refuses Steps that wait for each other", () => {
    const steps = [step("a", "c"), step("b", "a"), step("c", "b")];
    expect(() => levels({ steps })).toThrow(PipelineError);
    expect(findCycle({ steps })).toEqual(["a", "b", "c", "a"]);
  });

  it("refuses a Step that waits for itself, an unknown Step or a repeated id", () => {
    expect(pipelineProblems({ steps: [step("a", "a")] })).toHaveLength(1);
    expect(pipelineProblems({ steps: [step("a", "zz")] })[0]).toMatch(/zz/);
    expect(pipelineProblems({ steps: [step("a"), step("a")] })[0]).toMatch(
      /twice/,
    );
    expect(() => levels({ steps: [step("a", "zz")] })).toThrow(PipelineError);
  });
});

describe("upstream", () => {
  it("lists everything a Step waits for, near or far, in listed order", () => {
    const steps = [step("a"), step("b", "a"), step("c"), step("d", "b", "c")];
    expect(upstream({ steps }, "d")).toEqual(["a", "b", "c"]);
    expect(upstream({ steps }, "a")).toEqual([]);
  });
});

describe("PIPELINES", () => {
  it("holds only valid Pipelines with known ids", () => {
    for (const pipeline of PIPELINES) {
      expect(isPipelineId(pipeline.id)).toBe(true);
      expect(pipelineProblems(pipeline)).toEqual([]);
    }
  });
});
