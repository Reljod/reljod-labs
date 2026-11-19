import { describe, expect, it } from "vitest";
import { blocks, checkView } from "./chart-checks";
import { partsOf, titleOf } from "./chat";
import { guardStatement, minimumGroupTemplate, parametersOf } from "./guard";
import extraFixtures from "./guard.fixtures.extra.json";
import fixtures from "./guard.fixtures.json";
import {
  applyRuleEdits,
  defaultRulebook,
  normaliseRulebook,
  settings,
} from "./rules";
import { STUB_SPEC, stubPlan } from "./stub";
import { type CanvasClaims, readCanvasToken, signCanvasToken } from "./token";
import { verifyView } from "./verify";
import {
  defaultParams,
  mergeParams,
  type QueryResult,
  type ViewSpec,
  viewSpecSchema,
} from "./view";

// The Guard, on statements DuckDB 2.0.0 really parsed (guard.fixtures.json) ---------------

type Case = { sql: string; ast: { error?: boolean } };
const cases = {
  ...fixtures.cases,
  ...extraFixtures.cases,
} as unknown as Record<string, Case>;
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
  },
};
const rules = settings(defaultRulebook());
const guard = (name: string, over: Partial<typeof rules> = {}) =>
  guardStatement({
    ast: cases[name].ast,
    template: fixtures.template.ast,
    catalog,
    rules: { ...rules, ...over },
  });

describe("the Guard", () => {
  it("passes a plain Query over open columns untouched", () => {
    for (const name of [
      "plain_load",
      "range_fn",
      "values",
      "not_restricted_cols",
      "star_exclude",
    ]) {
      const verdict = guard(name);
      expect(verdict.ok, name).toBe(true);
      if (verdict.ok) {
        expect(verdict.rewritten, name).toBe(false);
        expect(verdict.restrictedUsed, name).toEqual([]);
      }
    }
  });

  it("adds the minimum group size wherever a Restricted column is aggregated", () => {
    for (const name of [
      "avg_income",
      "avg_income_having",
      "small_groups",
      "global_avg",
      "histogram",
      "share_filter",
      "where_filter",
      "cte_ok",
      "rounded_avg",
      "avg_of_case",
      "banded_group",
      "aggregate_then_join",
      "nested_own_table",
    ]) {
      const verdict = guard(name);
      expect(verdict.ok, name).toBe(true);
      if (!verdict.ok) continue;
      expect(verdict.guardedSelects, name).toBeGreaterThan(0);
      expect(verdict.rewritten, name).toBe(true);
      expect(verdict.restrictedUsed.length, name).toBeGreaterThan(0);
      // The statement that runs carries `count_star() >= 10`; the input does not gain it.
      expect(JSON.stringify(verdict.ast), name).toContain("count_star");
      expect(verdict.ast, name).not.toBe(cases[name].ast);
    }
  });

  it("refuses the shapes an independent review found: each returned a household's own value", () => {
    const expected: Record<string, string> = {
      // A correlated or LATERAL subquery reaching for the outer row.
      correlated_scalar: "access.restricted_columns",
      lateral_leak: "access.restricted_columns",
      lateral_whole_row: "access.restricted_columns",
      nested_whole_row: "access.restricted_columns",
      // A CTE named after the Table, hiding the Table from the Guard.
      cte_shadow: "query.unknown_table",
      // A join or table function multiplying rows past the minimum group size.
      join_multiplies: "access.restricted_columns",
      self_join_multiplies: "access.restricted_columns",
      join_ok: "access.restricted_columns",
      // Aggregates and functions not known to summarise: denied by default.
      arbitrary_fn: "access.restricted_columns",
      quantile_disc_max: "access.restricted_columns",
      approx_top_k_fn: "access.restricted_columns",
      arg_max_null_fn: "access.restricted_columns",
      unknown_scalar: "access.restricted_columns",
    };
    for (const [name, rule] of Object.entries(expected)) {
      const verdict = guard(name);
      expect(verdict.ok, name).toBe(false);
      if (!verdict.ok) expect(verdict.rule, name).toBe(rule);
    }
  });

  it("still lets a join through when it touches no Restricted column", () => {
    const verdict = guard("open_join");
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.rewritten).toBe(false);
  });

  it("refuses every way of getting a Restricted column back row by row", () => {
    for (const name of [
      "row_level",
      "star",
      "star_alias",
      "whole_row",
      "columns_expr",
      "positional",
      "max_income",
      "list_income",
      "window",
      "cte_leak",
      "subquery_scalar",
      "distinct_leak",
      "order_leak",
      "union_leak",
    ]) {
      const verdict = guard(name);
      expect(verdict.ok, name).toBe(false);
      if (!verdict.ok) {
        expect(verdict.rule, name).toBe("access.restricted_columns");
        expect(verdict.message.length, name).toBeGreaterThan(20);
      }
    }
  });

  it("refuses files, anything that is not one SELECT, and Tables outside the Catalog", () => {
    const expected: Record<string, string> = {
      read_file: "query.no_files",
      read_parquet_string: "query.unknown_table",
      summarize: "query.select_only",
      describe: "query.select_only",
      show_tables: "query.select_only",
      two: "query.select_only",
      unknown_table: "query.unknown_table",
      schema_table: "query.unknown_table",
    };
    for (const [name, rule] of Object.entries(expected)) {
      const verdict = guard(name);
      expect(verdict.ok, name).toBe(false);
      if (!verdict.ok) expect(verdict.rule, name).toBe(rule);
    }
  });

  it("refuses a Table a Rule denies, and reads the minimum group size from the Rules", () => {
    const denied = guard("plain_load", {
      deniedTables: new Set(["grid_load"]),
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.rule).toBe("access.denied_tables");
    expect(minimumGroupTemplate(25)).toContain(">= 25");
    expect(minimumGroupTemplate(0)).toContain(">= 1");
  });

  it("fails closed when the template it borrows the HAVING from is missing", () => {
    const verdict = guardStatement({
      ast: cases.avg_income.ast,
      template: {},
      catalog,
      rules,
    });
    expect(verdict.ok).toBe(false);
  });

  it("an unrestricted Rulebook lets the same column through", () => {
    const verdict = guard("row_level", { restricted: new Map() });
    expect(verdict.ok).toBe(true);
  });

  it("names the Parameters a statement uses", () => {
    expect(parametersOf(cases.plain_load.ast)).toEqual(["from"]);
    expect(parametersOf(cases.range_fn.ast)).toEqual([]);
  });
});

// Verification -------------------------------------------------------------------------------

const result: QueryResult = {
  columns: [
    { name: "region", type: "varchar" },
    { name: "peak_mw", type: "double" },
  ],
  rows: [
    ["Haldenmouth", 1698.4],
    ["Durrany", 1644.3],
    ["Fennory Shore", 592.9],
  ],
  rowCount: 3,
  truncated: false,
  ms: 4,
};

const spec = (over: Partial<ViewSpec> = {}): ViewSpec =>
  viewSpecSchema.parse({
    grammar: "canvas.view/1",
    title: "Peak load by region",
    finding: "Haldenmouth peaked highest at 1698.4 MW.",
    claims: [
      {
        id: "top",
        label: "Haldenmouth peak",
        value: 1698.4,
        unit: "MW",
        from: { column: "peak_mw", aggregate: "max" },
      },
    ],
    query: { kind: "sql", sql: "select 1" },
    encoding: {
      kind: "bar",
      x: { field: "region", type: "category" },
      y: { field: "peak_mw" },
    },
    ...over,
  });

describe("verification", () => {
  it("marks a View Verified when code recomputes every narrated number", () => {
    const checked = verifyView(spec(), result, rules);
    expect(checked.status).toBe("verified");
    expect(checked.claims[0]).toMatchObject({ ok: true, actual: 1698.4 });
  });

  it("flags a Claim that the rows do not bear out, with both numbers", () => {
    const wrong = spec({
      finding: "Haldenmouth peaked highest at 1800 MW.",
      claims: [
        {
          id: "top",
          label: "Haldenmouth peak",
          value: 1800,
          from: { column: "peak_mw", aggregate: "max" },
        },
      ],
    });
    const checked = verifyView(wrong, result, rules);
    expect(checked.status).toBe("flagged");
    expect(checked.claims[0]).toMatchObject({
      ok: false,
      stated: 1800,
      actual: 1698.4,
    });
    expect(checked.reasons.length).toBeGreaterThan(0);
  });

  it("honours the tolerance from the Rules, and no further", () => {
    const near = spec({
      finding: "Haldenmouth peaked highest at 1700 MW.",
      claims: [
        {
          id: "top",
          label: "Haldenmouth peak",
          value: 1700,
          from: { column: "peak_mw", aggregate: "max" },
        },
      ],
    });
    expect(
      verifyView(near, result, { ...rules, tolerancePct: 0.5 }).status,
    ).toBe("verified");
    expect(
      verifyView(near, result, { ...rules, tolerancePct: 0.01 }).status,
    ).toBe("flagged");
  });

  it("flags a figure in the Finding that no Claim backs", () => {
    const loose = spec({
      finding: "Haldenmouth peaked highest at 1698.4 MW, 73% above the rest.",
    });
    const checked = verifyView(loose, result, rules);
    expect(checked.status).toBe("flagged");
    expect(checked.figures.some((figure) => figure.claimId === null)).toBe(
      true,
    );
    // The same Finding passes when that Rule is switched off.
    expect(
      verifyView(loose, result, { ...rules, flagUnbackedFigures: false })
        .status,
    ).toBe("verified");
  });

  it("flags a Claim whose column is not in the rows", () => {
    const missing = spec({
      claims: [
        {
          id: "top",
          label: "Haldenmouth peak",
          value: 1698.4,
          from: { column: "nope", aggregate: "max" },
        },
      ],
    });
    const checked = verifyView(missing, result, rules);
    expect(checked.status).toBe("flagged");
    expect(checked.claims[0].actual).toBeNull();
  });

  it("finds a Claim's value through a where", () => {
    const where = spec({
      finding: "Durrany reached 1644.3 MW.",
      claims: [
        {
          id: "d",
          label: "Durrany peak",
          value: 1644.3,
          from: {
            column: "peak_mw",
            aggregate: "value",
            where: { region: "Durrany" },
          },
        },
      ],
    });
    expect(verifyView(where, result, rules).status).toBe("verified");
  });
});

// Chart Rules --------------------------------------------------------------------------------

describe("chart checks", () => {
  it("passes a bar chart over its own fields", () => {
    expect(blocks(checkView(spec(), result, rules))).toBe(false);
  });

  it("blocks a View whose fields are not in the result", () => {
    const bad = spec({
      encoding: {
        kind: "bar",
        x: { field: "region", type: "category" },
        y: { field: "missing" },
      },
    });
    const findings = checkView(bad, result, rules);
    expect(blocks(findings)).toBe(true);
    expect(findings[0].rule).toBe("view.fields");
  });

  it("blocks a pie with more slices than the Rule allows, until the Rule is raised or off", () => {
    const pie = spec({
      encoding: {
        kind: "pie",
        category: { field: "region" },
        value: { field: "peak_mw" },
      },
    });
    const many: QueryResult = {
      ...result,
      rows: Array.from({ length: 7 }, (_, index) => [`R${index}`, 10 + index]),
      rowCount: 7,
    };
    expect(blocks(checkView(pie, many, rules))).toBe(true);
    expect(blocks(checkView(pie, many, { ...rules, pieMaxSlices: 8 }))).toBe(
      false,
    );
    expect(blocks(checkView(pie, many, { ...rules, pieMaxSlices: null }))).toBe(
      false,
    );
  });

  it("blocks bars that do not start at zero while that Rule is on", () => {
    const zoomed = spec({
      encoding: {
        kind: "bar",
        x: { field: "region", type: "category" },
        y: { field: "peak_mw", zero: false },
      },
    });
    expect(blocks(checkView(zoomed, result, rules))).toBe(true);
    expect(
      blocks(checkView(zoomed, result, { ...rules, barsStartAtZero: false })),
    ).toBe(false);
  });

  it("checks a custom palette for colour-blind safety", () => {
    const clash = spec({
      encoding: {
        kind: "bar",
        x: { field: "region", type: "category" },
        y: { field: "peak_mw" },
        colors: ["#d73027", "#d7301f"],
      },
    });
    expect(
      checkView(clash, result, rules).some(
        (f) => f.rule === "chart.colour_blind_safe",
      ),
    ).toBe(true);
  });
});

// Rules as data ------------------------------------------------------------------------------

describe("Rule edits", () => {
  const known = { tables: catalog.tables };

  it("applies a valid edit and names what changed", () => {
    const applied = applyRuleEdits(
      defaultRulebook(),
      [{ id: "verify.tolerance", params: { percent: 1 } }],
      known,
    );
    expect(applied.errors).toEqual([]);
    expect(applied.changed).toEqual(["verify.tolerance"]);
    expect(settings(applied.rulebook).tolerancePct).toBe(1);
  });

  it("refuses a value out of range, an unknown Rule and an unknown column", () => {
    const applied = applyRuleEdits(
      defaultRulebook(),
      [
        { id: "verify.tolerance", params: { percent: 900 } },
        { id: "no.such_rule", enabled: false },
        {
          id: "access.restricted_columns",
          params: { columns: ["grid_load.nope"] },
        },
      ],
      known,
    );
    expect(applied.errors.map((error) => error.id).sort()).toEqual([
      "access.restricted_columns",
      "no.such_rule",
      "verify.tolerance",
    ]);
    expect(applied.changed).toEqual([]);
  });

  it("will not switch off a Rule the product cannot work without", () => {
    const applied = applyRuleEdits(
      defaultRulebook(),
      [{ id: "access.restricted_columns", enabled: false }],
      known,
    );
    expect(applied.errors.length).toBe(1);
  });

  it("an edit that changes nothing changes nothing", () => {
    const applied = applyRuleEdits(
      defaultRulebook(),
      [{ id: "verify.tolerance", params: { percent: 0.5 } }],
      known,
    );
    expect(applied.changed).toEqual([]);
  });

  it("reads a stored Rulebook back to a usable one, whatever is in it", () => {
    expect(normaliseRulebook(null)).toEqual(defaultRulebook());
    const odd = normaliseRulebook({
      "verify.tolerance": { enabled: true, params: { percent: "x" } },
    });
    expect(settings(odd).tolerancePct).toBe(0.5);
  });

  it("a Rule can only lower the row and time caps, never raise them past LIMITS", () => {
    const book = defaultRulebook();
    book["query.max_rows"].params.rows = 10_000_000;
    book["query.max_seconds"].params.seconds = 10_000;
    expect(settings(book).maxRows).toBeLessThanOrEqual(5000);
    expect(settings(book).maxSeconds).toBeLessThanOrEqual(30);
  });
});

// Parameters ---------------------------------------------------------------------------------

describe("Parameters", () => {
  it("starts from the spec's own values", () => {
    expect(defaultParams(STUB_SPEC)).toEqual({
      from: "2025-02-01",
      to: "2025-03-01",
      min_peak: 0,
    });
  });

  it("clamps a slider to its bounds and refuses the wrong type or an unknown name", () => {
    const merged = mergeParams(STUB_SPEC, {}, { min_peak: 99_999 });
    expect(merged.values.min_peak).toBe(3000);
    const bad = mergeParams(
      STUB_SPEC,
      {},
      { min_peak: "2000", nope: 1, from: "tomorrow" },
    );
    expect(bad.errors.length).toBe(3);
    expect(bad.values.min_peak).toBe(0);
  });

  it("the grammar refuses a Control bound to a Parameter the View does not declare", () => {
    const parsed = viewSpecSchema.safeParse({
      ...STUB_SPEC,
      params: STUB_SPEC.params.filter((param) => param.name !== "min_peak"),
    });
    expect(parsed.success).toBe(false);
  });

  it("the grammar has no place for HTML or script", () => {
    const parsed = viewSpecSchema.safeParse({
      ...STUB_SPEC,
      html: "<script>1</script>",
    });
    expect(parsed.success && "html" in parsed.data).toBe(false);
  });
});

// Tokens -------------------------------------------------------------------------------------

describe("MCP tokens", () => {
  const secret = "test-salt";
  const claims: CanvasClaims = {
    kind: "guest",
    via: "pasted",
    owner: "guest:11111111-1111-4111-8111-111111111111",
    visitor: "abc",
    user: "u1",
    pass: "11111111-1111-4111-8111-111111111111",
    exp: Math.floor(Date.now() / 1000) + 60,
  };

  it("round-trips its claims", () => {
    expect(readCanvasToken(signCanvasToken(claims, secret), secret)).toEqual(
      claims,
    );
  });

  it("refuses a tampered, expired, wrongly keyed or mismatched token", () => {
    const token = signCanvasToken(claims, secret);
    expect(readCanvasToken(`${token}x`, secret)).toBeNull();
    expect(readCanvasToken(token, "other-salt")).toBeNull();
    expect(readCanvasToken(token, secret, Date.now() + 120_000)).toBeNull();
    const [head, signature] = token.split(".");
    const forged = `canvas_${Buffer.from(JSON.stringify({ ...claims, owner: "e2e", kind: "e2e" })).toString("base64url")}.${signature}`;
    expect(head).toMatch(/^canvas_/);
    expect(readCanvasToken(forged, secret)).toBeNull();
    // A Guest token must be for its own Guest pass.
    expect(
      readCanvasToken(
        signCanvasToken({ ...claims, pass: "someone-else" }, secret),
        secret,
      ),
    ).toBeNull();
    expect(readCanvasToken(undefined, secret)).toBeNull();
    expect(readCanvasToken("sieve_abc.def", secret)).toBeNull();
  });
});

// The turn's events --------------------------------------------------------------------------

describe("a turn's events", () => {
  it("fold into the parts a message keeps", () => {
    const parts = partsOf([
      { type: "text.delta", text: "Here " },
      { type: "text.delta", text: "it is." },
      {
        type: "tool.started",
        id: "t1",
        name: "run_query",
        args: { sql: "select 1" },
      },
      { type: "tool.finished", id: "t1", ok: true, summary: "1 row", ms: 12 },
      { type: "tool.started", id: "t2", name: "create_view", args: {} },
    ]);
    expect(parts).toEqual([
      { type: "text", text: "Here it is." },
      {
        type: "tool",
        id: "t1",
        name: "run_query",
        args: { sql: "select 1" },
        ok: true,
        summary: "1 row",
        ms: 12,
      },
      {
        type: "tool",
        id: "t2",
        name: "create_view",
        args: {},
        ok: false,
        summary: "Did not finish",
        ms: 0,
      },
    ]);
  });

  it("titles a Conversation after its first Question", () => {
    expect(titleOf("  What   happened? ")).toBe("What happened?");
    expect(titleOf("x".repeat(200)).length).toBeLessThanOrEqual(70);
  });

  it("the stubbed Analyst makes a View, or tries the Restricted column when asked to", () => {
    expect(stubPlan("anything").map((call) => call.name)).toEqual([
      "list_tables",
      "run_query",
      "create_view",
    ]);
    expect(
      stubPlan("show income per household row by row")[0].args.sql,
    ).toContain("household_id");
    expect(viewSpecSchema.safeParse(STUB_SPEC).success).toBe(true);
  });
});
