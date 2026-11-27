import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { guardStatement, minimumGroupTemplate } from "../../domain/guard";
import { defaultRulebook, settings } from "../../domain/rules";
import { STUB_PROBES, STUB_SPEC, stubPlan } from "../../domain/stub";
import { stubSandbox } from "./stub";
import fixtures from "./stub.fixtures.json";

/*
 * The stubbed e2e suite proves the Guard only if the canned Sandbox hands it
 * the trees DuckDB really gives for the suite's statements. Every statement
 * the suite sends must be recorded, and the Guard must judge each one as the
 * suite expects: a stub that parsed everything as an error would pass the
 * refusals for the wrong reason.
 */

const catalog = {
  tables: {
    household_survey: [
      "household_id",
      "region_code",
      "monthly_income_mdc",
      "respondent_age",
      "household_size",
      "municipality",
    ],
    grid_load: ["ts", "region_code", "load_mw"],
    card_spend: [
      "date",
      "branch_id",
      "region_code",
      "category",
      "transactions",
      "amount_mdc",
    ],
  },
};
const rules = settings(defaultRulebook());

async function parsed(sql: string) {
  const { answer } = await stubSandbox.run(
    "e2e",
    { op: "serialize", sqls: [sql, minimumGroupTemplate(rules.minGroupSize)] },
    30,
  );
  const [ast, template] = answer.asts as unknown[];
  return guardStatement({ ast, template, catalog, rules });
}

describe("the stub Sandbox", () => {
  it("has DuckDB's own tree for every statement the stubbed suite sends", () => {
    const recorded = new Set(
      Object.values(fixtures.cases).map((item) => item.sql.trim()),
    );
    const sent = [
      STUB_SPEC.query.kind === "sql" ? STUB_SPEC.query.sql : "",
      ...Object.values(STUB_PROBES),
      ...[
        ...stubPlan("anything"),
        ...stubPlan("income per household row by row"),
      ]
        .map((call) => call.args.sql)
        .filter((sql): sql is string => typeof sql === "string"),
    ];
    for (const sql of sent) expect(recorded, sql).toContain(sql.trim());
    for (const item of Object.values(fixtures.cases))
      expect((item.ast as { error?: boolean }).error, item.sql).toBe(false);
  });

  it("lets the Guard refuse and pass exactly what the suite expects", async () => {
    for (const sql of [STUB_PROBES.rowLevel, STUB_PROBES.hiddenInSubquery]) {
      const verdict = await parsed(sql);
      expect(verdict.ok, sql).toBe(false);
      if (!verdict.ok) expect(verdict.message).toMatch(/Restricted/i);
    }
    expect((await parsed(STUB_PROBES.readFile)).ok).toBe(false);
    const mean = await parsed(STUB_PROBES.meanIncome);
    expect(mean.ok && mean.guardedSelects).toBeGreaterThan(0);
    expect((await parsed(STUB_PROBES.cardAmounts)).ok).toBe(true);
  });

  it("runs the View's Query with its Parameters, and the Guard's rewrite of a Query", async () => {
    const view = STUB_SPEC.query.kind === "sql" ? STUB_SPEC.query.sql : "";
    const run = (params: Record<string, unknown>) =>
      stubSandbox.run(
        "e2e",
        { op: "query", sql: view, params, maxRows: 5000 },
        30,
      );
    const all = await run({
      from: "2025-02-01",
      to: "2025-03-01",
      min_peak: 0,
    });
    expect(all.answer.rowCount).toBe(28);
    const high = await run({
      from: "2025-02-01",
      to: "2025-03-01",
      min_peak: 2000,
    });
    expect(high.answer.rowCount).toBeLessThan(28);
    const mean = await parsed(STUB_PROBES.meanIncome);
    if (!mean.ok) throw new Error(mean.message);
    const rewritten = await stubSandbox.run(
      "e2e",
      { op: "query", ast: mean.ast, params: {}, maxRows: 5000 },
      30,
    );
    expect(rewritten.answer.error).toBeUndefined();
    expect(rewritten.answer.rowCount).toBeGreaterThan(0);
  });
});
