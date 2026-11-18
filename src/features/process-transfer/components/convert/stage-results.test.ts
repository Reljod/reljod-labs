import { describe, expect, it } from "vitest";
import { STAGE_IDS } from "../../domain/run";
import { hasResults, RESULT_ANCHOR, stageResults } from "./stage-results";

describe("stageResults", () => {
  it("sends each Stage to the tab that shows what it made", () => {
    expect(stageResults("watch")).toEqual({
      tab: "steps",
      anchor: RESULT_ANCHOR.transcript,
    });
    expect(stageResults("extract").anchor).toBe(RESULT_ANCHOR.steps);
    expect(stageResults("verify").anchor).toBe(RESULT_ANCHOR.processChecks);
    expect(stageResults("document").tab).toBe("document");
    expect(stageResults("design").tab).toBe("deck");
    expect(stageResults("check").tab).toBe("deck");
    expect(stageResults("approve").tab).toBe("deck");
  });

  it("covers every Stage", () => {
    for (const id of STAGE_IDS) expect(stageResults(id)).toBeDefined();
  });
});

describe("hasResults", () => {
  it("is true only once a Stage has started", () => {
    expect(hasResults("done")).toBe(true);
    expect(hasResults("running")).toBe(true);
    expect(hasResults("failed")).toBe(true);
    expect(hasResults("pending")).toBe(false);
    expect(hasResults("skipped")).toBe(false);
  });
});
