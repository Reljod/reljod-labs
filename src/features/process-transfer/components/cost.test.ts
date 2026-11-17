import { describe, expect, it } from "vitest";
import type { ModelCall } from "../domain/models";
import {
  costByPurpose,
  costByStage,
  earlierCalls,
  isReplaced,
  modelLabel,
  roundOfCall,
  stageOfCall,
  totalOf,
} from "./cost";

const call = (
  id: string,
  purpose: ModelCall["purpose"],
  label: string,
  costUsd: number,
  model = "google/gemini-3.8-flash",
): ModelCall => ({
  id,
  purpose,
  label,
  model,
  inputTokens: 1000,
  outputTokens: 200,
  costUsd,
  ms: 1500,
  at: "2026-11-17T12:00:00Z",
});

const calls = [
  call("1", "watch", "Watch the Recording", 0.02),
  call("2", "write", "Write the Process", 0.004, "anthropic/claude-haiku-5.5"),
  call("3", "review", "Check the steps against the Recording", 0.006),
  call("4", "write", "Repair the Process", 0.003, "anthropic/claude-haiku-5.5"),
  call("5", "write", "Plan the slides", 0.005, "anthropic/claude-haiku-5.5"),
  call("6", "review", "Review the slides (round 1)", 0.004),
  call(
    "7",
    "write",
    "Revise the slides (round 2)",
    0.005,
    "anthropic/claude-haiku-5.5",
  ),
  call("8", "review", "Review the slides (round 2)", 0.004),
];

describe("stageOfCall", () => {
  it("places every call on the Stage that made it", () => {
    expect(calls.map(stageOfCall)).toEqual([
      "watch",
      "extract",
      "verify",
      "verify",
      "design",
      "check",
      "design",
      "check",
    ]);
  });
});

it("reads the labels the pipeline writes", () => {
  expect(
    stageOfCall({ purpose: "review", label: "Check the repaired steps" }),
  ).toBe("verify");
  expect(
    stageOfCall({
      purpose: "write",
      label: "Plan the slides (unusable output)",
    }),
  ).toBe("design");
});

describe("roundOfCall", () => {
  it("reads the Round from the label", () => {
    expect(roundOfCall("Plan the slides (round 2)")).toBe(2);
    expect(roundOfCall("Write the Process")).toBeNull();
  });
});

describe("cost roll-ups", () => {
  it("adds up per Stage, per purpose and overall", () => {
    const byStage = costByStage(calls);
    expect(byStage.design.calls).toBe(2);
    expect(byStage.design.costUsd).toBeCloseTo(0.01);
    expect(byStage.verify.models).toEqual([
      "google/gemini-3.8-flash",
      "anthropic/claude-haiku-5.5",
    ]);
    expect(byStage.document.calls).toBe(0);
    expect(byStage.approve.costUsd).toBe(0);

    const byPurpose = costByPurpose(calls);
    expect(byPurpose.write.calls).toBe(4);
    expect(byPurpose.review.costUsd).toBeCloseTo(0.014);

    const total = totalOf(calls);
    expect(total.calls).toBe(8);
    expect(total.costUsd).toBeCloseTo(0.051);
    expect(total.inputTokens).toBe(8000);
  });

  it("shows Design and Check for the latest Redo only, and still totals every call", () => {
    const redone = [
      ...calls,
      ...calls
        .filter((call) => ["design", "check"].includes(stageOfCall(call)))
        .map((call, index) => ({
          ...call,
          id: `redo-${index}`,
          generation: 1,
        })),
    ];
    const before = costByStage(calls);
    const after = costByStage(redone);
    expect(after.design.calls).toBe(before.design.calls);
    expect(after.check.calls).toBe(before.check.calls);
    expect(after.extract.calls).toBe(before.extract.calls);
    // Only the replaced Design and Check calls; Watch, Extract and Verify still stand.
    expect(earlierCalls(redone).map((call) => call.id)).toEqual([
      "5",
      "6",
      "7",
      "8",
    ]);
    expect(isReplaced(redone[0], 1)).toBe(false);
    expect(isReplaced(redone[4], 1)).toBe(true);
    expect(isReplaced(redone[4], 0)).toBe(false);
    expect(totalOf(redone).calls).toBe(redone.length);
  });

  it("names known models and passes unknown ids through", () => {
    expect(modelLabel("anthropic/claude-haiku-5.5")).toBe("Claude Haiku 5.5");
    expect(modelLabel("acme/x")).toBe("acme/x");
  });
});
