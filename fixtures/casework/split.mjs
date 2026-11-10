#!/usr/bin/env node
/**
 * Splits the Cabinet into train / validation / test at 60:20:20 by document,
 * per scenario, writing `splits.json`. Whole cases go to one split, so no
 * case's pages leak across splits. Deterministic: same cases, same split.
 *
 *   node fixtures/casework/split.mjs
 *
 * train: rules and prompts may be tuned against these.
 * validation: checked while tuning, to catch overfitting.
 * test: held out; only reported, never tuned against.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CASES = join(ROOT, "cases");
const RATIOS = { train: 0.6, validation: 0.2, test: 0.2 };

function rank(slug, attempt) {
  return createHash("sha256")
    .update(`${attempt}:${slug}`)
    .digest()
    .readUInt32BE(0);
}

/**
 * Picks cases whose document counts sum to `target`, or within one document of
 * it when whole cases cannot hit it exactly (a scenario of 3- and 4-document cases).
 */
function pick(cases, target, attempt, slack) {
  const order = [...cases].sort(
    (a, b) => rank(a.slug, attempt) - rank(b.slug, attempt),
  );
  const chosen = [];
  let total = 0;
  for (const item of order) {
    if (total + item.docs <= target + slack) {
      chosen.push(item);
      total += item.docs;
    }
    if (total >= target - slack) break;
  }
  return Math.abs(total - target) <= slack ? chosen : null;
}

const splits = {};
for (const scenario of readdirSync(CASES).sort()) {
  const cases = readdirSync(join(CASES, scenario))
    .filter((slug) => existsSync(join(CASES, scenario, slug, "case.json")))
    .map((slug) => {
      const data = JSON.parse(
        readFileSync(join(CASES, scenario, slug, "case.json"), "utf8"),
      );
      return {
        slug,
        docs: data.documents.length,
        outcome: data.expected.recommendation,
      };
    });
  const total = cases.reduce((sum, item) => sum + item.docs, 0);
  const testTarget = Math.round(total * RATIOS.test);
  const validationTarget = Math.round(total * RATIOS.validation);

  let found = null;
  for (let attempt = 0; attempt < 20000 && !found; attempt++) {
    const slack = attempt < 5000 ? 0 : 1;
    const test = pick(cases, testTarget, `t${attempt}`, slack);
    if (!test) continue;
    const rest = cases.filter((item) => !test.includes(item));
    const validation = pick(rest, validationTarget, `v${attempt}`, slack);
    if (!validation) continue;
    const train = rest.filter((item) => !validation.includes(item));
    // Stratify: held-out splits each hold an approve and at least one other outcome.
    const mixed = (group) =>
      group.some((item) => item.outcome === "approve") &&
      group.some((item) => item.outcome !== "approve");
    if (!mixed(test) || !mixed(validation) || !mixed(train)) continue;
    found = { train, validation, test };
  }
  if (!found) throw new Error(`No 60:20:20 split for ${scenario}`);
  for (const [split, group] of Object.entries(found)) {
    for (const item of group) splits[item.slug] = split;
  }
  const docs = (name) => found[name].reduce((sum, item) => sum + item.docs, 0);
  console.log(
    `${scenario}: train ${docs("train")} docs (${found.train.length} cases), validation ${docs("validation")} (${found.validation.length}), test ${docs("test")} (${found.test.length})`,
  );
}

const sorted = Object.fromEntries(
  Object.entries(splits).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(
  join(ROOT, "splits.json"),
  `${JSON.stringify(sorted, null, 2)}\n`,
);
