import "server-only";
import { CATALOG, type Cell, tableRows } from "../../domain/data";
import type { JobAnswer, SandboxRunner } from "../ports";
import fixtures from "./stub.fixtures.json";

/*
 * The stubbed e2e suite's Sandbox: deterministic, in process, free. It
 * parses from statements DuckDB 2.0.0 really parsed (`stub.fixtures.json`,
 * written by `scripts/canvas-stub-fixtures.py`), so the Guard, which is pure
 * code, judges real trees exactly as it does live. It runs only the few
 * statements the suite sends, computing their rows from the same seeded
 * generator the Sandbox image is loaded from. Anything else is refused, and
 * it never runs code.
 */

type Fixture = { sql: string; ast: unknown };
const CASES = fixtures.cases as Record<string, Fixture>;

type Row = Record<string, Cell>;
type Answer = { columns: { name: string; type: string }[]; rows: Cell[][] };

/** A Meridia table's rows by column name. Memoised: the generator is seeded, so they never change. */
const tables = new Map<string, Row[]>();
function rowsOf(name: string): Row[] {
  let rows = tables.get(name);
  if (!rows) {
    const columns = CATALOG.find((table) => table.name === name)?.columns ?? [];
    rows = [];
    for (const cells of tableRows(name))
      rows.push(
        Object.fromEntries(
          columns.map((column, at) => [column.name, cells[at]]),
        ),
      );
    tables.set(name, rows);
  }
  return rows;
}

const round = (value: number, digits = 0) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/** Groups rows by a key and folds each group. */
function groups<T>(
  rows: Row[],
  key: (row: Row) => string,
  fold: (rows: Row[]) => T,
) {
  const by = new Map<string, Row[]>();
  for (const row of rows) {
    const k = key(row);
    const list = by.get(k);
    if (list) list.push(row);
    else by.set(k, [row]);
  }
  return [...by.entries()].map(([k, list]) => [k, fold(list)] as const);
}

const max = (rows: Row[], column: string) =>
  Math.max(...rows.map((row) => Number(row[column])));
const mean = (rows: Row[], column: string) =>
  rows.reduce((sum, row) => sum + Number(row[column]), 0) / rows.length;

/** What each statement of the suite returns, by fixture name. */
const ANSWERS: Record<string, (params: Record<string, unknown>) => Answer> = {
  view: (params) => {
    const from = String(params.from ?? "").slice(0, 10);
    const to = String(params.to ?? "").slice(0, 10);
    const threshold = Number(params.min_peak ?? 0);
    const days = groups(
      rowsOf("grid_load").filter((row) => {
        const day = String(row.ts).slice(0, 10);
        return row.region_code === "KES" && day >= from && day < to;
      }),
      (row) => String(row.ts).slice(0, 10),
      (rows) => max(rows, "load_mw"),
    )
      .filter(([, peak]) => peak >= threshold)
      .sort(([a], [b]) => a.localeCompare(b));
    return {
      columns: [
        { name: "day", type: "date" },
        { name: "peak_mw", type: "double" },
      ],
      rows: days.map(([day, peak]) => [day, round(peak, 1)]),
    };
  },
  peak_by_region: () => ({
    columns: [
      { name: "region_code", type: "varchar" },
      { name: "peak_mw", type: "double" },
    ],
    rows: groups(
      rowsOf("grid_load"),
      (row) => String(row.region_code),
      (rows) => round(max(rows, "load_mw"), 1),
    )
      .sort(([, a], [, b]) => b - a)
      .map(([region, peak]) => [region, peak]),
  }),
  // Every region holds thousands of households, far above any minimum group size.
  mean_income: () => ({
    columns: [
      { name: "region_code", type: "varchar" },
      { name: "mean_income", type: "double" },
    ],
    rows: groups(
      rowsOf("household_survey"),
      (row) => String(row.region_code),
      (rows) => round(mean(rows, "monthly_income_mdc")),
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([region, income]) => [region, income]),
  }),
  card_amounts: () => ({
    columns: [{ name: "amount_mdc", type: "double" }],
    rows: rowsOf("card_spend")
      .slice(0, 3)
      .map((row) => [row.amount_mdc]),
  }),
};

/**
 * A statement's identity across the Guard's rewrite: its tree with keys in
 * order and every HAVING left out (the only thing the Guard adds). The suite
 * sends no two statements that differ only in their HAVING.
 */
function fingerprint(ast: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "having")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return JSON.stringify(canonical(ast));
}

const BY_SQL = new Map(
  Object.values(CASES).map((item) => [item.sql.trim(), item.ast]),
);
const BY_TREE = new Map(
  Object.entries(CASES).map(([name, item]) => [fingerprint(item.ast), name]),
);

/** `minimumGroupTemplate(k)` for any k, from the one DuckDB parsed (k = 10). */
function template(sql: string): unknown | null {
  const k = /^select 1 having true and count\(\*\) >= (\d+)$/.exec(sql)?.[1];
  if (!k) return null;
  const ast = structuredClone(CASES.template.ast) as {
    statements: {
      node: {
        having: { children: { right: { literal: { text: string } } }[] };
      };
    }[];
  };
  ast.statements[0].node.having.children[1].right.literal.text = k;
  return ast;
}

function parse(sql: string): unknown {
  return (
    template(sql.trim()) ??
    BY_SQL.get(sql.trim()) ?? {
      error: true,
      error_message:
        "The stub Sandbox has not parsed this statement (scripts/canvas-stub-fixtures.py).",
    }
  );
}

function query(job: Record<string, unknown>): JobAnswer {
  const tree =
    typeof job.sql === "string" ? BY_SQL.get(job.sql.trim()) : job.ast;
  const name = tree === undefined ? undefined : BY_TREE.get(fingerprint(tree));
  const answer = name ? ANSWERS[name] : undefined;
  if (!answer)
    return {
      error: "The stub Sandbox has no rows for this Query.",
      kind: "sql",
    };
  const { columns, rows } = answer(
    (job.params ?? {}) as Record<string, unknown>,
  );
  const maxRows = Number(job.maxRows ?? rows.length);
  return {
    columns,
    rows: rows.slice(0, maxRows),
    rowCount: rows.length,
    truncated: rows.length > maxRows,
    ms: 1,
    ...(typeof job.sql === "string" ? { sql: job.sql } : {}),
  };
}

/** The canned Sandbox of the stubbed e2e suite. */
export const stubSandbox: SandboxRunner = {
  async run(_owner, job) {
    if (job.op === "serialize")
      return {
        answer: { asts: (job.sqls as string[]).map(parse) },
        ms: 1,
      };
    if (job.op === "query") return { answer: query(job), ms: 1 };
    return {
      answer: {
        error:
          "Code needs the Sandbox, which the stubbed suite runs without. Answer with SQL instead.",
        kind: "runner",
      },
      ms: 1,
    };
  },
};
