import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedLines,
  diffsByFile,
  locationsFor,
  SPEC_PATH,
  selectTests,
  testStarts,
} from "./e2e-select.mjs";

const SCRIPT = join(import.meta.dirname, "e2e-select.mjs");

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

  it("charges a change between tests to the test before it, and the tail to the last test", () => {
    // Line 8 is the `test.describe(` header, inside the first test's range.
    expect(selectTests(spec, "@@ -8 +8 @@")).toEqual([4]);
    expect(selectTests(spec, "@@ -14 +14 @@")).toEqual([13]);
    expect(selectTests(spec, "@@ -14,0 +15,3 @@")).toEqual([13]);
  });

  it("runs a serial spec whole, and a parallel one by line", () => {
    const serial = `test.describe.configure({ mode: "serial" });\n${spec}`;
    expect(locationsFor("e2e/a.spec.ts", serial, "@@ -6 +6 @@")).toEqual([
      "e2e/a.spec.ts",
    ]);
    expect(locationsFor("e2e/a.spec.ts", spec, "@@ -5 +5 @@")).toEqual([
      "e2e/a.spec.ts:4",
    ]);
    expect(locationsFor("e2e/a.spec.ts", serial, "@@ -1 +1 @@")).toEqual([
      "e2e/a.spec.ts",
    ]);
    expect(locationsFor("e2e/a.spec.ts", serial, "")).toEqual([]);
  });

  it("runs the whole spec for a change that can reach several tests", () => {
    // Above the first test (a helper), and the `test.describe(` header.
    expect(locationsFor("e2e/a.spec.ts", spec, "@@ -2 +2 @@")).toEqual([
      "e2e/a.spec.ts",
    ]);
    expect(locationsFor("e2e/a.spec.ts", spec, "@@ -8 +8 @@")).toEqual([
      "e2e/a.spec.ts",
    ]);
    // A test.use or a hook inside a describe, between tests.
    const hooked = spec.replace(
      'test.describe("group", () => {',
      'test.describe("group", () => {\n  test.use({ locale: "en" });',
    );
    expect(locationsFor("e2e/a.spec.ts", hooked, "@@ -9 +9 @@")).toEqual([
      "e2e/a.spec.ts",
    ]);
  });

  it("keeps an added line that starts with ++ inside its hunk", () => {
    const diff = [
      "diff --git a/e2e/a.spec.ts b/e2e/a.spec.ts",
      "--- a/e2e/a.spec.ts",
      "+++ b/e2e/a.spec.ts",
      "@@ -1 +1,2 @@",
      "+++counter;",
      "@@ -9 +10 @@",
    ].join("\n");
    const files = diffsByFile(diff);
    expect([...files.keys()]).toEqual(["e2e/a.spec.ts"]);
    expect([...changedLines(files.get("e2e/a.spec.ts") ?? "")]).toEqual([
      1, 2, 10,
    ]);
  });

  it("names only plain spec files", () => {
    expect(SPEC_PATH.test("e2e/bank.spec.ts")).toBe(true);
    expect(SPEC_PATH.test("e2e/nested/x.spec.ts")).toBe(false);
    expect(SPEC_PATH.test("e2e/$(touch x).spec.ts")).toBe(false);
    expect(SPEC_PATH.test("src/x.spec.ts")).toBe(false);
  });
});

describe("e2e-select, through git", () => {
  it("picks added and changed tests, and nothing for a pure rename or a helper", () => {
    const repo = mkdtempSync(join(tmpdir(), "e2e-select-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
      git("init", "-q", "-b", "main");
      git("config", "user.email", "test@example.invalid");
      git("config", "user.name", "test");
      execFileSync("mkdir", ["e2e"], { cwd: repo });
      writeFileSync(join(repo, "e2e/kept.spec.ts"), spec);
      writeFileSync(join(repo, "e2e/moved.spec.ts"), spec);
      writeFileSync(join(repo, "e2e/helper.ts"), "export const x = 1;\n");
      git("add", ".");
      git("commit", "-q", "-m", "base");
      const base = git("rev-parse", "HEAD");

      writeFileSync(
        join(repo, "e2e/kept.spec.ts"),
        spec.replace("  helper();\n});", "  helper();\n  helper();\n});"),
      );
      renameSync(
        join(repo, "e2e/moved.spec.ts"),
        join(repo, "e2e/renamed.spec.ts"),
      );
      writeFileSync(
        join(repo, "e2e/added.spec.ts"),
        'import { test } from "@playwright/test";\ntest("new", async () => {});\n',
      );
      writeFileSync(join(repo, "e2e/helper.ts"), "export const x = 2;\n");
      git("add", "-A");
      git("commit", "-q", "-m", "head");
      const head = git("rev-parse", "HEAD");

      const out = execFileSync("node", [SCRIPT, base, head], {
        cwd: repo,
        encoding: "utf8",
      });
      // A new spec runs whole (its import line sits above the first test).
      expect(out.trim().split("\n").sort()).toEqual([
        "e2e/added.spec.ts",
        "e2e/kept.spec.ts:4",
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
