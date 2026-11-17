import { describe, expect, it } from "vitest";
import { hrefOf, isTabId, placeOf } from "./place";

describe("hrefOf and placeOf", () => {
  it("round-trip a place through the address", () => {
    const place = {
      tab: "pipelines" as const,
      params: { run: "r-1", session: "s-1" },
    };
    expect(hrefOf(place)).toBe(
      "/demos/harness?tab=pipelines&session=s-1&run=r-1",
    );
    expect(placeOf(hrefOf(place).split("?")[1] ?? "")).toEqual(place);
  });

  it("leave Chat off the address, and fall back to Chat for an unknown tab", () => {
    expect(hrefOf({ tab: "chat", params: {} })).toBe("/demos/harness");
    expect(placeOf("tab=nope&run=r&other=x")).toEqual({
      tab: "chat",
      params: { run: "r" },
    });
  });
});

describe("isTabId", () => {
  it("knows the six tabs", () => {
    expect(isTabId("audit")).toBe(true);
    expect(isTabId("settings")).toBe(false);
    expect(isTabId(null)).toBe(false);
  });
});
