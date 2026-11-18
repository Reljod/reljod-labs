import { describe, expect, it } from "vitest";
import { readsFor, TAB_READS } from "./first-view";
import { TAB_IDS } from "./place";

describe("readsFor", () => {
  it("reads Chat's lists on every load, since Chat is always mounted", () => {
    for (const tab of TAB_IDS) {
      const reads = readsFor({ tab, params: {} });
      for (const read of TAB_READS.chat) expect(reads).toContain(read);
    }
  });

  it("adds the address's tab's lists, each once", () => {
    expect(readsFor({ tab: "pipelines", params: {} })).toEqual([
      "sessions",
      "runs",
      "rules",
    ]);
    expect(readsFor({ tab: "knowledge", params: {} })).toEqual([
      "sessions",
      "runs",
      "sources",
      "conflicts",
    ]);
    expect(readsFor({ tab: "docs", params: {} })).toEqual(["sessions", "runs"]);
  });
});
