import "server-only";
import { randomUUID } from "node:crypto";
import {
  type GuardPass,
  guardStatement,
  minimumGroupTemplate,
  parametersOf,
} from "../domain/guard";
import { LIMITS } from "../domain/limits";
import type { WorkRun } from "../domain/payload";
import { type RuleSettings, settings } from "../domain/rules";
import type { ParamValues, QueryResult, ResultColumn } from "../domain/view";
import type { Caller } from "./caller";
import { catalogFor, type OwnerCatalog } from "./catalog";
import { isUuid, sql } from "./db";
import { InvalidError, LimitError, RuleRefusal } from "./errors";
import { takeRate } from "./rate";
import { currentRulebook } from "./rules";
import { type Job, runJob } from "./sandbox/session";
import { trail, trailStrict } from "./trail";

/*
 * Runs (GLOSSARY): every Query and every piece of code goes through here,
 * whoever asks: the page, the Analyst or an outside MCP client. The order is
 * fixed. Limits, then the Guard on the parsed statement, then the Trail event
 * that says it is about to run, then the Sandbox, then the Trail event that
 * says how it went.
 */

/** What the Rules and the Catalog are for this Owner right now. */
export type RunContext = {
  rulebookVersion: number;
  rules: RuleSettings;
  catalog: OwnerCatalog;
};

export async function runContext(caller: Pick<Caller, "owner">) {
  const [rulebook, catalog] = await Promise.all([
    currentRulebook(caller.owner),
    catalogFor(caller.owner),
  ]);
  return {
    rulebookVersion: rulebook.version,
    rules: settings(rulebook.rulebook),
    catalog,
  } satisfies RunContext;
}

/** A statement the Guard passed, kept with a View so a Control runs it again without parsing. */
export type GuardedStatement = {
  /** For code: the input's name. */
  name?: string;
  /** The SQL as written. */
  sql: string;
  /** The statement to run when the Guard changed it; null when the SQL runs as written. */
  ast: unknown | null;
  tables: string[];
  restrictedUsed: string[];
  guardedSelects: number;
};

export type Guarded = {
  rulebookVersion: number;
  statements: GuardedStatement[];
};

// Limits -------------------------------------------------------------------------------------

/** Takes one Run from the hourly allowance and checks the Question's Sandbox time. */
async function admit(caller: Caller) {
  await takeRate(caller.visitor, caller.owner, "run");
  if (!isUuid(caller.questionId)) return;
  const [row] = await sql()<{ sandbox_ms: number }[]>`
    select sandbox_ms from canvas.messages
    where id = ${caller.questionId} and owner = ${caller.owner}`;
  if (row && row.sandbox_ms >= LIMITS.sandboxSecondsPerQuestion * 1000)
    throw new LimitError(
      `This Question has used its ${LIMITS.sandboxSecondsPerQuestion} s of Sandbox time. Answer with what you have.`,
    );
}

async function spend(caller: Caller, ms: number) {
  if (!isUuid(caller.questionId)) return;
  await sql()`
    update canvas.messages set sandbox_ms = sandbox_ms + ${Math.round(ms)}
    where id = ${caller.questionId} and owner = ${caller.owner}`;
}

// The Guard ----------------------------------------------------------------------------------

type Parsed = { error?: boolean; error_message?: string };

/**
 * Parses each SQL in the Sandbox and puts it through the Guard. Throws a
 * RuleRefusal that says what to change; the refusal is on the Trail.
 */
export async function guardAll(
  caller: Caller,
  context: RunContext,
  statements: { name?: string; sql: string }[],
  params: ParamValues,
): Promise<Guarded> {
  for (const statement of statements)
    if (statement.sql.length > LIMITS.queryChars)
      throw new InvalidError(
        `A Query may be at most ${LIMITS.queryChars} characters.`,
      );
  // Parsing is a Sandbox command too: taken from the hourly allowance before
  // it runs, so a stream of Queries the Guard refuses is capped like any other.
  await takeRate(caller.visitor, caller.owner, "run");
  const { answer } = await runJob(
    caller.owner,
    {
      op: "serialize",
      sqls: [
        ...statements.map((statement) => statement.sql),
        minimumGroupTemplate(context.rules.minGroupSize),
      ],
    },
    LIMITS.runSeconds,
  );
  const asts = answer.asts as Parsed[] | undefined;
  if (!Array.isArray(asts) || asts.length !== statements.length + 1)
    throw new InvalidError(answer.error ?? "The Query could not be parsed.");
  const template = asts[asts.length - 1];
  const out: GuardedStatement[] = [];
  for (const [index, statement] of statements.entries()) {
    const ast = asts[index];
    const refuse = async (rule: string, message: string) => {
      await trail(caller, {
        action: "query.refused",
        summary: `Refused: ${message}`.slice(0, 280),
        detail: { rule, sql: statement.sql, input: statement.name },
      });
      return new RuleRefusal(rule, message);
    };
    if (ast?.error)
      throw await refuse(
        "query.parse",
        `DuckDB could not parse the SQL: ${ast.error_message ?? "syntax error"}`,
      );
    const verdict = guardStatement({
      ast,
      template,
      catalog: context.catalog.guard,
      rules: context.rules,
    });
    if (!verdict.ok) throw await refuse(verdict.rule, verdict.message);
    const missing = parametersOf(ast).filter((name) => !(name in params));
    if (missing.length > 0)
      throw await refuse(
        "query.parameters",
        `The Query uses ${missing.map((name) => `$${name}`).join(", ")} but the View declares no such Parameter.`,
      );
    out.push(statementOf(statement, verdict));
  }
  return { rulebookVersion: context.rulebookVersion, statements: out };
}

const statementOf = (
  statement: { name?: string; sql: string },
  verdict: GuardPass,
): GuardedStatement => ({
  ...(statement.name ? { name: statement.name } : {}),
  sql: statement.sql,
  ast: verdict.rewritten ? verdict.ast : null,
  tables: verdict.tables,
  restrictedUsed: verdict.restrictedUsed,
  guardedSelects: verdict.guardedSelects,
});

const jobStatement = (statement: GuardedStatement) =>
  statement.ast === null ? { sql: statement.sql } : { ast: statement.ast };

// Running ------------------------------------------------------------------------------------

export type Ran = {
  result: QueryResult;
  run: WorkRun;
  /** stdout and stderr, for code. */
  output?: { stdout: string; stderr: string; exitCode: number };
};

const runOf = (
  kind: WorkRun["kind"],
  label: string,
  text: string,
  fields: Partial<WorkRun>,
): WorkRun => ({
  id: randomUUID(),
  kind,
  label,
  text,
  guardedSql: null,
  rows: null,
  ms: 0,
  ok: true,
  error: null,
  at: new Date().toISOString(),
  ...fields,
});

const cleanColumns = (value: unknown): ResultColumn[] =>
  Array.isArray(value)
    ? value.map((column) => ({
        name: String((column as ResultColumn).name),
        type: String((column as ResultColumn).type),
      }))
    : [];

/** The message a failed Run shows: DuckDB's own words help the Analyst fix the SQL. */
const failureOf = (
  answer: { error?: string; kind?: string },
  seconds: number,
) =>
  answer.kind === "timeout"
    ? `Stopped after ${seconds} s (Rule "query.max_seconds"). Aggregate more, or filter to fewer rows.`
    : (answer.error ?? "The Run failed.");

/**
 * Runs one guarded SELECT and returns its rows, capped at the Rules' row
 * limit with the true count beside them.
 */
export async function runGuardedQuery(
  caller: Caller,
  context: RunContext,
  statement: GuardedStatement,
  params: ParamValues,
  label: string,
  maxRows = context.rules.maxRows,
): Promise<Ran> {
  await admit(caller);
  const seconds = context.rules.maxSeconds;
  await trailStrict(caller, {
    action: "query.started",
    summary: `${label}: ${statement.sql.replace(/\s+/g, " ").slice(0, 160)}`,
    detail: {
      label,
      sql: statement.sql,
      params,
      guarded: statement.ast !== null,
    },
  });
  const job: Job = {
    op: "query",
    ...jobStatement(statement),
    params,
    maxRows,
    seconds,
    uploads: context.catalog.uploadTables.filter((name) =>
      statement.tables.includes(name),
    ),
  };
  const { answer, ms } = await runJob(caller.owner, job, seconds);
  await spend(caller, ms);
  if (answer.error) {
    const message = failureOf(answer, seconds);
    await trail(caller, {
      action: "query.finished",
      summary: `${label} failed: ${message}`.slice(0, 280),
      detail: { label, ok: false, error: message },
      ms,
    });
    throw new InvalidError(message);
  }
  const result: QueryResult = {
    columns: cleanColumns(answer.columns),
    rows: (answer.rows as QueryResult["rows"]) ?? [],
    rowCount: Number(answer.rowCount ?? 0),
    truncated: Boolean(answer.truncated),
    ms: Number(answer.ms ?? ms),
  };
  const ranSql = typeof answer.sql === "string" ? answer.sql : statement.sql;
  await trail(caller, {
    action: "query.finished",
    summary: `${label}: ${result.rowCount} row${result.rowCount === 1 ? "" : "s"} in ${result.ms} ms`,
    detail: {
      label,
      ok: true,
      rows: result.rowCount,
      truncated: result.truncated,
      columns: result.columns.map((column) => column.name),
      ...(statement.ast !== null ? { guardedSql: ranSql } : {}),
      tables: statement.tables,
      restrictedUsed: statement.restrictedUsed,
    },
    ms,
  });
  return {
    result,
    run: runOf("query", label, statement.sql, {
      guardedSql: statement.ast !== null ? ranSql : null,
      rows: result.rowCount,
      ms: result.ms,
    }),
  };
}

/**
 * Runs code over guarded inputs, as the unprivileged user. The inputs are
 * SELECTs the Guard passed, so a Restricted column reaches code only
 * aggregated. `needsTable` is true for a View: its code must end with
 * `canvas.table(...)`.
 */
export async function runGuardedCode(
  caller: Caller,
  context: RunContext,
  inputs: GuardedStatement[],
  code: string,
  params: ParamValues,
  label: string,
  needsTable: boolean,
): Promise<Ran> {
  if (code.length > LIMITS.queryChars)
    throw new InvalidError(
      `Code may be at most ${LIMITS.queryChars} characters.`,
    );
  await admit(caller);
  const seconds = context.rules.maxSeconds;
  await trailStrict(caller, {
    action: "code.started",
    summary: `${label}: ${code.split("\n").length} lines of Python over ${inputs.length} input${inputs.length === 1 ? "" : "s"}`,
    detail: {
      label,
      code,
      inputs: inputs.map((input) => ({ name: input.name, sql: input.sql })),
      params,
    },
  });
  const tables = new Set(inputs.flatMap((input) => input.tables));
  const job: Job = {
    op: "code",
    inputs: inputs.map((input) => ({
      name: input.name,
      ...jobStatement(input),
    })),
    code,
    params,
    seconds,
    maxRows: context.rules.maxRows,
    maxInputRows: LIMITS.rowsToCode,
    outputChars: LIMITS.outputChars,
    uploads: context.catalog.uploadTables.filter((name) => tables.has(name)),
  };
  const { answer, ms } = await runJob(caller.owner, job, seconds);
  await spend(caller, ms);
  const output = {
    stdout: String(answer.stdout ?? ""),
    stderr: String(answer.stderr ?? ""),
    exitCode: Number(answer.exitCode ?? 1),
  };
  const table = answer.table as
    | (Omit<QueryResult, "ms"> & { columns: unknown })
    | null
    | undefined;
  const failed = answer.error
    ? failureOf(answer, seconds)
    : output.exitCode !== 0
      ? `The code exited with ${output.exitCode}.\n${output.stderr.slice(-1500)}`
      : needsTable && !table
        ? "The code ran but set no result. End it with canvas.table(columns, rows)."
        : null;
  await trail(caller, {
    action: "code.finished",
    summary: failed
      ? `${label} failed: ${failed.split("\n")[0]}`.slice(0, 280)
      : `${label}: ${table ? `${table.rowCount} rows` : "no table"} in ${ms} ms`,
    detail: {
      label,
      ok: !failed,
      exitCode: output.exitCode,
      rows: table?.rowCount ?? null,
      inputs: answer.inputs ?? [],
      stdout: output.stdout.slice(0, 2000),
      stderr: output.stderr.slice(0, 2000),
    },
    ms,
  });
  if (failed) throw new InvalidError(failed);
  const result: QueryResult = table
    ? {
        columns: cleanColumns(table.columns),
        rows: table.rows,
        rowCount: table.rowCount,
        truncated: table.truncated,
        ms: Number(answer.ms ?? ms),
      }
    : { columns: [], rows: [], rowCount: 0, truncated: false, ms };
  return {
    result,
    output,
    run: runOf("code", label, code, {
      rows: table ? result.rowCount : null,
      ms: Number(answer.ms ?? ms),
    }),
  };
}

// What the tools call ------------------------------------------------------------------------

/** `run_query`: one SELECT, guarded and run. */
export async function runQuery(
  caller: Caller,
  input: {
    sql: string;
    params?: ParamValues;
    label?: string;
    maxRows?: number;
  },
) {
  const context = await runContext(caller);
  const params = input.params ?? {};
  const guarded = await guardAll(caller, context, [{ sql: input.sql }], params);
  const statement = guarded.statements[0];
  const ran = await runGuardedQuery(
    caller,
    context,
    statement,
    params,
    input.label ?? "Query",
    Math.min(input.maxRows ?? context.rules.maxRows, context.rules.maxRows),
  );
  return { ...ran, statement, context };
}

/** `run_code`: Python over guarded inputs. */
export async function runCode(
  caller: Caller,
  input: {
    inputs: { name: string; sql: string }[];
    code: string;
    params?: ParamValues;
    label?: string;
  },
) {
  const context = await runContext(caller);
  const params = input.params ?? {};
  const guarded = await guardAll(caller, context, input.inputs, params);
  const ran = await runGuardedCode(
    caller,
    context,
    guarded.statements,
    input.code,
    params,
    input.label ?? "Code",
    false,
  );
  return { ...ran, statements: guarded.statements, context };
}
