import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CaseFile, caseFileSchema } from "./case-file";
import { simulate } from "./execute";
import { sameName } from "./names";
import { PIPELINES } from "./pipelines";
import type { FieldValue, RunState } from "./run-state";
import { WATCHLIST } from "./watchlist";

const ROOT = join(__dirname, "../../../../fixtures/casework/cases");
const SPLITS: Record<string, "train" | "validation" | "test"> = JSON.parse(
  readFileSync(join(ROOT, "../splits.json"), "utf8"),
);

function loadCases(): CaseFile[] {
  return readdirSync(ROOT).flatMap((scenario) =>
    readdirSync(join(ROOT, scenario)).map((slug) =>
      caseFileSchema.parse(
        JSON.parse(
          readFileSync(join(ROOT, scenario, slug, "case.json"), "utf8"),
        ),
      ),
    ),
  );
}

/** A Run whose Read was perfect: every Document carries its label. */
export function stateFromLabels(item: CaseFile): RunState {
  return {
    runId: item.slug,
    asOf: item.asOf,
    pipeline: item.expected.pipeline,
    documents: item.documents.map((document, index) => ({
      id: `${item.slug}:${index}`,
      name: document.name,
      mediaType: "application/pdf",
      sourceFormat: "pdf_digital",
      pageCount: 1,
      kind: document.kind,
      fields: document.label as Record<string, FieldValue>,
    })),
    checks: [],
    gaps: [],
    answers: [],
  };
}

export function runCase(item: CaseFile) {
  return simulate(
    stateFromLabels(item),
    PIPELINES[item.expected.pipeline].jobs,
    WATCHLIST,
  );
}

const cases = loadCases();

describe("the Cabinet", () => {
  it("holds 50 documents per scenario", () => {
    const counts = new Map<string, number>();
    for (const item of cases) {
      counts.set(
        item.scenario,
        (counts.get(item.scenario) ?? 0) + item.documents.length,
      );
    }
    expect(Object.fromEntries(counts)).toEqual({
      employer_onboarding: 50,
      pension_withdrawal: 50,
      screening_review: 50,
      structure_review: 50,
    });
  });
});

/**
 * With perfect reads, the rules should reach the labelled outcome. Agreement
 * is reported per case; the suite fails if it drops below the bar.
 */
describe("rules against labels", () => {
  const results = cases.map((item) => {
    const state = runCase(item);
    const checkMisses = item.expected.checks.flatMap((expected) => {
      const actual = state.checks.find((check) => check.id === expected.id);
      return actual && actual.outcome !== expected.outcome
        ? [
            `${expected.id}: expected ${expected.outcome}, got ${actual.outcome} (${actual.detail})`,
          ]
        : [];
    });
    const hitMisses = (item.expected.hits ?? []).flatMap((expected) => {
      const actual = state.hits?.find((hit) =>
        sameName(hit.hitName, expected.name, 95),
      );
      return actual?.disposition === expected.disposition
        ? []
        : [
            `hit ${expected.name}: expected ${expected.disposition}, got ${actual?.disposition ?? "no hit"}`,
          ];
    });
    const uboMisses = (item.expected.ubos ?? []).filter(
      (name) => !state.ownership?.ubos.some((ubo) => sameName(ubo.name, name)),
    );
    return {
      split: SPLITS[item.slug],
      slug: item.slug,
      expected: item.expected.recommendation,
      actual: state.decision?.recommendation,
      checkMisses,
      hitMisses,
      uboMisses,
      arrears:
        item.expected.arrears === undefined
          ? null
          : [item.expected.arrears, state.arrears?.total ?? 0],
    };
  });

  it("reports agreement", () => {
    // Tuning looks at train and validation only; test is held out and only scored.
    const report = results
      .filter((result) => result.split !== "test")
      .filter(
        (result) =>
          result.expected !== result.actual ||
          result.checkMisses.length ||
          result.hitMisses.length ||
          result.uboMisses.length ||
          (result.arrears &&
            Math.abs(result.arrears[0] - result.arrears[1]) > 0.05),
      )
      .map(
        (result) =>
          `[${result.split}] ${result.slug}: ${result.expected} vs ${result.actual}\n    ${[...result.checkMisses, ...result.hitMisses, ...result.uboMisses.map((name) => `missing UBO ${name}`), ...(result.arrears && Math.abs(result.arrears[0] - result.arrears[1]) > 0.05 ? [`arrears ${result.arrears[0]} vs ${result.arrears[1]}`] : [])].join("\n    ")}`,
      );
    if (process.env.GOLDEN_REPORT) console.log(report.join("\n"));
    const score = (split: string) => {
      const group = results.filter((result) => result.split === split);
      const agreed = group.filter(
        (result) => result.expected === result.actual,
      ).length;
      return { agreed, total: group.length, rate: agreed / group.length };
    };
    const scores = {
      train: score("train"),
      validation: score("validation"),
      test: score("test"),
    };
    if (process.env.GOLDEN_REPORT) {
      for (const [split, value] of Object.entries(scores)) {
        console.log(
          `${split}: ${value.agreed}/${value.total} recommendations agree`,
        );
      }
    }
    expect(scores.train.rate).toBeGreaterThanOrEqual(0.85);
    expect(scores.validation.rate).toBeGreaterThanOrEqual(0.8);
  });
});
