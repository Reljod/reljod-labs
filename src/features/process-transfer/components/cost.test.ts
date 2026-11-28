import { describe, expect, it } from "vitest";
import type { ModelCall } from "../domain/models";
import {
  costByPurpose,
  costByStage,
  earlierCalls,
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

/* The cost a person is shown must add up to what the Run was charged. */
describe("cost roll-ups", () => {
  it("adds up per Stage, per purpose and overall", () => {
    const byStage = costByStage(calls);
    expect(byStage.design.calls).toBe(2);
    expect(byStage.design.costUsd).toBeCloseTo(0.01);
    expect(byStage.document.calls).toBe(0);

    const byPurpose = costByPurpose(calls);
    expect(byPurpose.write.calls).toBe(4);
    expect(byPurpose.review.costUsd).toBeCloseTo(0.014);

    const total = totalOf(calls);
    expect(total.calls).toBe(8);
    expect(total.costUsd).toBeCloseTo(0.051);
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
    expect(totalOf(redone).calls).toBe(redone.length);
  });
});
