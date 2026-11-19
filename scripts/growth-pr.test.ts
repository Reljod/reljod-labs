import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * scripts/growth-pr.sh is the only thing that keeps a Bank Growth pull
 * request's code away from the e2e secrets (e2e-changed.yml) and decides
 * whether the growth guard applies. It runs here against a fake `gh` that
 * answers from files: pr.json for the pull request, issue-<n>.json for an
 * issue, issue-<n>.status for an HTTP error.
 */

const SCRIPT = join(import.meta.dirname, "growth-pr.sh");

const FAKE_GH = `#!/usr/bin/env bash
# gh api <path> [--jq <filter>]
path="$2"; filter=""
if [ "$3" = "--jq" ]; then filter="$4"; fi
case "$path" in
  repos/*/pulls/*) file="$FAKE_DIR/pr.json"; status_file="$FAKE_DIR/pr.status" ;;
  repos/*/issues/*) n="\${path##*/}"; file="$FAKE_DIR/issue-$n.json"; status_file="$FAKE_DIR/issue-$n.status" ;;
  *) echo "unexpected path $path" >&2; exit 3 ;;
esac
if [ -f "$status_file" ]; then echo "gh: request failed (HTTP $(cat "$status_file"))" >&2; exit 1; fi
if [ ! -f "$file" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
if [ -n "$filter" ]; then jq -r "$filter" "$file"; else cat "$file"; fi
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "growth-pr-"));
  writeFileSync(join(dir, "gh"), FAKE_GH);
  chmodSync(join(dir, "gh"), 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function pr(fields: {
  labels?: string[];
  ref?: string;
  title?: string;
  body?: string | null;
}) {
  writeFileSync(
    join(dir, "pr.json"),
    JSON.stringify({
      labels: (fields.labels ?? []).map((name) => ({ name })),
      head: { ref: fields.ref ?? "feat/something" },
      title: fields.title ?? "feat: something",
      body: fields.body === undefined ? "" : fields.body,
    }),
  );
}

function issue(number: number, labels: string[]) {
  writeFileSync(
    join(dir, `issue-${number}.json`),
    JSON.stringify({ labels: labels.map((name) => ({ name })) }),
  );
}

function run() {
  const output = join(dir, "output");
  writeFileSync(output, "");
  const result = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_DIR: dir,
      REPO: "owner/repo",
      PR: "7",
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: dir,
    },
  });
  return {
    status: result.status,
    growth: /growth=(true|false)/.exec(readFileSync(output, "utf8"))?.[1],
    stderr: result.stderr,
  };
}

describe("growth-pr.sh", () => {
  it("is growth for the label", () => {
    pr({ labels: ["bank:growth"] });
    expect(run()).toMatchObject({ status: 0, growth: "true" });
  });

  it("is growth for a bank-growth/ branch", () => {
    pr({ ref: "bank-growth/61-search" });
    expect(run()).toMatchObject({ status: 0, growth: "true" });
  });

  it("is growth for a reference to a bank:growth issue, by number or URL", () => {
    issue(61, ["bank:growth", "bank:feature"]);
    pr({ body: "Closes #61" });
    expect(run()).toMatchObject({ status: 0, growth: "true" });
    pr({ body: "See https://github.com/owner/repo/issues/61" });
    expect(run()).toMatchObject({ status: 0, growth: "true" });
  });

  it("is not growth for an ordinary pull request, a null body or another issue", () => {
    pr({ body: null });
    expect(run()).toMatchObject({ status: 0, growth: "false" });
    issue(5, ["bug"]);
    pr({ body: "Fixes #5" });
    expect(run()).toMatchObject({ status: 0, growth: "false" });
  });

  it("skips a number that is not an issue (404) and keeps looking", () => {
    issue(61, ["bank:growth"]);
    pr({ body: "Follows #3, closes #61" });
    expect(run()).toMatchObject({ status: 0, growth: "true" });
  });

  it("fails closed when an issue cannot be read (5xx, rate limit)", () => {
    pr({ body: "Closes #61" });
    writeFileSync(join(dir, "issue-61.status"), "502");
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.growth).toBeUndefined();
    expect(result.stderr).toContain("Could not read issue #61");
  });

  it("fails closed when the pull request cannot be read", () => {
    writeFileSync(join(dir, "pr.status"), "500");
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.growth).toBeUndefined();
  });

  it("refuses a pull request number that is not a number", () => {
    pr({});
    const result = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, REPO: "owner/repo", PR: "1;rm -rf /" },
    });
    expect(result.status).toBe(2);
  });
});
