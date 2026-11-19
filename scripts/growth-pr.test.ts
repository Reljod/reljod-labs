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
 * answers the GraphQL query from pr.json, or fails when gh.status exists.
 */

const SCRIPT = join(import.meta.dirname, "growth-pr.sh");

const FAKE_GH = `#!/usr/bin/env bash
# gh api graphql -f query=… -f owner=… -f name=… -F number=… --jq <filter>
if [ "$1 $2" != "api graphql" ]; then echo "unexpected: $*" >&2; exit 3; fi
filter=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--jq" ]; then filter="$2"; fi
  shift
done
if [ -f "$FAKE_DIR/gh.status" ]; then echo "gh: request failed (HTTP $(cat "$FAKE_DIR/gh.status"))" >&2; exit 1; fi
jq -c "$filter" "$FAKE_DIR/pr.json"
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

const names = (list: string[]) => ({ nodes: list.map((name) => ({ name })) });

function pr(fields: {
  labels?: string[];
  ref?: string;
  closes?: { number: number; labels: string[] }[];
}) {
  writeFileSync(
    join(dir, "pr.json"),
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            headRefName: fields.ref ?? "feat/something",
            labels: names(fields.labels ?? []),
            closingIssuesReferences: {
              nodes: (fields.closes ?? []).map((issue) => ({
                number: issue.number,
                labels: names(issue.labels),
              })),
            },
          },
        },
      },
    }),
  );
}

function run(env: Record<string, string> = {}) {
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
      ...env,
    },
  });
  return {
    status: result.status,
    growth: /growth=(true|false)/.exec(readFileSync(output, "utf8"))?.[1],
    stdout: result.stdout,
  };
}

describe("growth-pr.sh", () => {
  it("is growth for the label", () => {
    pr({ labels: ["bank:growth"] });
    expect(run()).toMatchObject({ status: 0, growth: "true" });
  });

  it("is growth for a bank-growth/ branch", () => {
    pr({ ref: "bank-growth/61" });
    expect(run()).toMatchObject({ status: 0, growth: "true" });
  });

  it("is growth when it closes a bank:growth issue", () => {
    pr({ closes: [{ number: 61, labels: ["bank:growth", "bank:feature"] }] });
    const result = run();
    expect(result).toMatchObject({ status: 0, growth: "true" });
    expect(result.stdout).toContain("it closes #61");
  });

  it("is not growth when it closes only ordinary issues, or none", () => {
    pr({ closes: [{ number: 5, labels: ["bug"] }] });
    expect(run()).toMatchObject({ status: 0, growth: "false" });
    pr({});
    expect(run()).toMatchObject({ status: 0, growth: "false" });
  });

  it("fails closed when the pull request cannot be read", () => {
    pr({});
    writeFileSync(join(dir, "gh.status"), "502");
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.growth).toBeUndefined();
  });

  it("fails closed when the pull request does not exist", () => {
    writeFileSync(
      join(dir, "pr.json"),
      JSON.stringify({ data: { repository: { pullRequest: null } } }),
    );
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.growth).toBeUndefined();
  });

  it("refuses a pull request number or repository that is not plain", () => {
    pr({});
    expect(run({ PR: "1;rm -rf /" }).status).toBe(2);
    expect(run({ REPO: "no-owner" }).status).toBe(2);
  });
});
