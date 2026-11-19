import { describe, expect, it } from "vitest";
import {
  changedLines,
  diffsByFile,
  SPEC_PATH,
  selectTests,
  testStarts,
} from "./e2e-select.mjs";

const spec = [
  'import { test } from "@playwright/test";', // 1
  "const helper = () => 1;", // 2
  "", // 3
  'test("first", async () => {', // 4
  "  helper();", // 5
  "});", // 6
  "", // 7
  'test.describe("group", () => {', // 8
  '  test("nested", async () => {', // 9
  "    helper();", // 10
  "  });", // 11
  "});", // 12
  "test.skip(`last`, async () => {", // 13
  "});", // 14
].join("\n");

describe("e2e-select", () => {
  it("finds every test, nested or skipped, but not a describe", () => {
    expect(testStarts(spec)).toEqual([4, 9, 13]);
  });

  it("reads the new-side lines of a -U0 diff, including a pure deletion", () => {
    const diff = ["@@ -5 +5 @@", "@@ -9,0 +10,2 @@", "@@ -20,3 +19,0 @@"].join(
      "\n",
    );
    expect([...changedLines(diff)].sort((a, b) => a - b)).toEqual([
      5, 10, 11, 20,
    ]);
  });

  it("selects only the tests whose lines changed", () => {
    expect(selectTests(spec, "@@ -5 +5 @@")).toEqual([4]);
    expect(selectTests(spec, "@@ -10 +10 @@\n@@ -13 +13 @@")).toEqual([9, 13]);
  });

  it("selects nothing for a change outside every test", () => {
    expect(selectTests(spec, "@@ -2 +2 @@")).toEqual([]);
    expect(selectTests(spec, "")).toEqual([]);
  });

  it("selects a test that was added", () => {
    expect(selectTests(spec, "@@ -12,0 +13,2 @@")).toEqual([13]);
  });

  it("splits a multi-file diff by the new path, and skips deleted files", () => {
    const diff = [
      "diff --git a/e2e/a.spec.ts b/e2e/a.spec.ts",
      "--- a/e2e/a.spec.ts",
      "+++ b/e2e/a.spec.ts",
      "@@ -1 +1 @@",
      "diff --git a/e2e/gone.spec.ts b/e2e/gone.spec.ts",
      "--- a/e2e/gone.spec.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
    ].join("\n");
    const files = diffsByFile(diff);
    expect([...files.keys()]).toEqual(["e2e/a.spec.ts"]);
    expect(files.get("e2e/a.spec.ts")).toContain("@@ -1 +1 @@");
  });

  it("names only plain spec files", () => {
    expect(SPEC_PATH.test("e2e/bank.spec.ts")).toBe(true);
    expect(SPEC_PATH.test("e2e/nested/x.spec.ts")).toBe(false);
    expect(SPEC_PATH.test("e2e/$(touch x).spec.ts")).toBe(false);
    expect(SPEC_PATH.test("src/x.spec.ts")).toBe(false);
  });
});
