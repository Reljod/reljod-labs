import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../domain/contract";
import { applyEvents, emptyView } from "./view";

describe("a failed Examination on the page", () => {
  it("clears verdict and a 0/0 gate when an Examination ends as failed", () => {
    const events: StoredEvent[] = [
      {
        seq: 1,
        at: 1,
        type: "findings",
        findings: [],
        verdict: {
          verdict: "genuine",
          reasons: ["No Measurement tripped a Rule."],
          decisive: 0,
          supporting: 0,
          context: 0,
        },
        rulebookVersion: 0,
      },
      {
        seq: 2,
        at: 2,
        type: "gate",
        gate: {
          passed: true,
          pagesTotal: 0,
          pagesLooked: 0,
          findingsOpen: 0,
          hypothesesOpen: 0,
        },
      },
      {
        seq: 3,
        at: 3,
        type: "end",
        status: "failed",
        gatePassed: false,
        error: "The Sample's file could not be read.",
      },
    ];
    const view = applyEvents(emptyView(), events);
    expect(view.status).toBe("failed");
    expect(view.verdict).toBeNull();
    expect(view.gate).toBeNull();
    expect(view.error).toBe("The Sample's file could not be read.");
  });
});
