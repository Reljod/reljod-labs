import { describe, expect, it } from "vitest";
import { parseTab } from "./tabs";

describe("parseTab", () => {
  it("accepts a known tab and falls back to Convert", () => {
    expect(parseTab("rules")).toBe("rules");
    expect(parseTab("nope")).toBe("convert");
    expect(parseTab(["rules"])).toBe("convert");
    expect(parseTab(undefined)).toBe("convert");
  });
});
