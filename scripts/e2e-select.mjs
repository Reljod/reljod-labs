#!/usr/bin/env node
/**
 * Picks the end-to-end tests a pull request adds or changes, so pull request
 * CI runs those and not the whole suite (the whole suite runs after a merge
 * to main: .github/workflows/e2e.yml).
 *
 * Run by .github/workflows/e2e-changed.yml from the BASE branch's copy of this
 * file. It reads the pull request's spec files as text through git and never
 * executes them. It prints Playwright locations (`e2e/<name>.spec.ts:<line>`),
 * one per line, so no test title (text from the pull request) reaches a shell
 * or a regex.
 *
 *   node scripts/e2e-select.mjs <base sha> <head sha>
 *
 * A test is selected when the diff touches a line between its `test(` and the
 * next test. A change outside every test (imports, helpers, `test.use`,
 * e2e/global-setup.ts, playwright.config.ts) selects nothing on its own: the
 * full run after the merge covers it.
 */
import { execFileSync } from "node:child_process";

/** A spec the selector may name: e2e/<plain name>.spec.ts, nothing nested or odd. */
export const SPEC_PATH = /^e2e\/[A-Za-z0-9._-]+\.spec\.ts$/;
/** A test, at any depth: `test(`, `test.only(`, `test.fixme(` or `test.skip(`, named by a string. */
const TEST_START = /^\s*test(?:\.(?:only|fixme|skip))?\(\s*["'`]/;
/** `@@ -a,b +c,d @@`: the new side starts at line c and spans d lines (1 when d is left out). */
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** The new-side line numbers a `-U0` unified diff of one file touches. */
export function changedLines(diff) {
  const lines = new Set();
  for (const row of diff.split("\n")) {
    const hunk = HUNK.exec(row);
    if (!hunk) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    // `+c,0`: lines were removed after new line c (0 = at the top).
    if (count === 0) lines.add(start + 1);
    for (let line = start; line < start + count; line++) lines.add(line);
  }
  return lines;
}

/** The 1-based line each test starts on. */
export function testStarts(spec) {
  const starts = [];
  spec.split("\n").forEach((row, index) => {
    if (TEST_START.test(row)) starts.push(index + 1);
  });
  return starts;
}

/** The start line of every test whose lines the diff touches. */
export function selectTests(spec, diff) {
  const changed = [...changedLines(diff)];
  const starts = testStarts(spec);
  return starts.filter((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] - 1 : Infinity;
    return changed.some((line) => line >= start && line <= end);
  });
}

/** Splits `git diff` output into one diff per new-side file path. */
export function diffsByFile(diff) {
  const files = new Map();
  let current = null;
  for (const row of diff.split("\n")) {
    if (row.startsWith("diff --git ")) current = null;
    else if (row.startsWith("+++ ")) {
      current = row.startsWith("+++ b/") ? row.slice(6) : null;
      if (current) files.set(current, "");
    } else if (current) files.set(current, `${files.get(current)}${row}\n`);
  }
  return files;
}

if (process.argv[1]?.endsWith("e2e-select.mjs")) {
  const [base, head] = process.argv.slice(2);
  const sha = /^[0-9a-f]{40}$/;
  if (!sha.test(base ?? "") || !sha.test(head ?? "")) {
    console.error("Usage: e2e-select.mjs <base sha> <head sha> (full SHAs)");
    process.exit(2);
  }
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });
  const diff = git(
    "diff",
    "-U0",
    "--no-color",
    "--diff-filter=AMR",
    `${base}...${head}`,
    "--",
    "e2e/*.spec.ts",
  );
  for (const [path, fileDiff] of diffsByFile(diff)) {
    if (!SPEC_PATH.test(path)) continue;
    const spec = git("show", `${head}:${path}`);
    for (const line of selectTests(spec, fileDiff)) {
      console.log(`${path}:${line}`);
    }
  }
}
