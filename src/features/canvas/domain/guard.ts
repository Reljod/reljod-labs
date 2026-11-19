import type { RuleId, RuleSettings } from "./rules";

/**
 * The Guard (GLOSSARY): the code between a Query and the data. It reads the
 * statement as DuckDB parsed it (`json_serialize_sql`), never the SQL text,
 * so a comment, a quoted name or odd spacing cannot hide anything from it.
 *
 * It refuses: anything that is not one SELECT; a Table that is not in the
 * Catalog or that a Rule denies; any table function but a few harmless ones
 * (so no file is ever read); and a Restricted column used in a way that
 * could return it row by row. Where a SELECT aggregates a Restricted column,
 * the Guard adds `HAVING count(*) >= <minimum group size>` to that SELECT in
 * the parsed statement. Only the rewritten statement is run.
 *
 * Pure: the parsed statements come from the Sandbox, the verdict is computed
 * here and unit-tested on statements DuckDB really produced.
 */

type Node = Record<string, unknown>;

export type GuardCatalog = {
  /** Table name to its column names, lower case. Uploads included. */
  tables: Record<string, readonly string[]>;
};

export type GuardRules = Pick<
  RuleSettings,
  "restricted" | "minGroupSize" | "deniedTables"
>;

export type GuardRefusal = {
  ok: false;
  rule: RuleId | "query.select_only" | "query.unknown_table" | "query.no_files";
  message: string;
};

export type GuardPass = {
  ok: true;
  /** The statement to run: the input, with the minimum group size added where needed. */
  ast: unknown;
  /** Catalog Tables the Query reads. */
  tables: string[];
  /** Restricted columns it aggregates, as `table.column` where the Table is known. */
  restrictedUsed: string[];
  /** How many SELECTs got the minimum group size. */
  guardedSelects: number;
  /** Whether `ast` differs from the input. When it does not, the SQL text may run as written. */
  rewritten: boolean;
};

export type GuardVerdict = GuardPass | GuardRefusal;

/** Table functions that read nothing. Every other one is refused. */
const SAFE_TABLE_FUNCTIONS = new Set(["range", "generate_series", "unnest"]);

/** Table references that are not a Table, a join or a subquery: SHOW, DESCRIBE, SUMMARIZE and the like. */
const REFUSED_REF_TYPES = new Set(["SHOW_REF", "COLUMN_DATA", "DELIM_GET"]);

/** Aggregates that summarise a group without handing back one row's value. */
export const SUMMARISING_AGGREGATES = new Set([
  "avg",
  "mean",
  "sum",
  "count",
  "count_star",
  "count_if",
  "countif",
  "median",
  "quantile",
  "quantile_cont",
  "quantile_disc",
  "approx_quantile",
  "stddev",
  "stddev_samp",
  "stddev_pop",
  "variance",
  "var_samp",
  "var_pop",
  "corr",
  "covar_pop",
  "covar_samp",
  "approx_count_distinct",
]);

const AGGREGATE_HINTS = new Set([
  ...SUMMARISING_AGGREGATES,
  "min",
  "max",
  "first",
  "last",
  "any_value",
  "arg_min",
  "arg_max",
  "min_by",
  "max_by",
  "list",
  "array_agg",
  "string_agg",
  "group_concat",
  "listagg",
  "histogram",
  "mode",
  "product",
  "bool_and",
  "bool_or",
  "bit_and",
  "bit_or",
  "bit_xor",
  "kurtosis",
  "skewness",
  "entropy",
]);

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const lower = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase() : "";

const isSelect = (node: Node) => node.type === "SELECT_NODE";

/** Visits every node under `root`; `enter` returns false to skip a subtree. */
function walk(
  root: unknown,
  enter: (node: Node, key: string) => boolean | undefined,
) {
  const visit = (value: unknown, key: string) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (!isNode(value)) return;
    if (enter(value, key) === false) return;
    for (const [name, child] of Object.entries(value)) visit(child, name);
  };
  visit(root, "");
}

function refuse(rule: GuardRefusal["rule"], message: string): GuardRefusal {
  return { ok: false, rule, message };
}

/** The names of the statement's CTEs: a reference to one is not a Table. */
function cteNames(root: unknown) {
  const names = new Set<string>();
  walk(root, (node) => {
    const map = (node.cte_map as Node | undefined)?.map;
    if (Array.isArray(map))
      for (const entry of map) if (isNode(entry)) names.add(lower(entry.key));
    return true;
  });
  return names;
}

type TableRef = { table: string; alias: string };

/**
 * The Catalog Tables a SELECT reads directly in its FROM (joins included,
 * subqueries and CTEs not: they are SELECTs of their own).
 */
function directTables(select: Node, ctes: Set<string>): TableRef[] {
  const found: TableRef[] = [];
  walk(select.from_table, (node) => {
    if (isSelect(node) || node.type === "SET_OPERATION_NODE") return false;
    if (node.class === "SUBQUERY" || node.type === "SUBQUERY") return false;
    if (node.type === "BASE_TABLE") {
      const table = lower(node.table_name);
      if (!ctes.has(table))
        found.push({ table, alias: lower(node.alias) || table });
    }
    return true;
  });
  return found;
}

type Use = {
  column: string;
  /** Under an aggregate that summarises. */
  summarised: boolean;
  /** Under an aggregate or window that can hand back one row's value. */
  revealing: string | null;
  /** In WHERE or a join condition. */
  filter: boolean;
  /** In SELECT, ORDER BY, HAVING or QUALIFY, outside any aggregate. */
  plain: boolean;
};

/** How a SELECT uses the given column names, not counting nested SELECTs. */
function usesIn(select: Node, names: Set<string>): Use[] {
  const uses: Use[] = [];
  const visit = (
    value: unknown,
    state: { summarised: boolean; revealing: string | null; filter: boolean },
  ) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, state);
      return;
    }
    if (!isNode(value)) return;
    if (isSelect(value) || value.type === "SET_OPERATION_NODE") return;
    let next = state;
    if (value.class === "WINDOW") {
      next = { ...state, revealing: lower(value.function_name) || "a window" };
    } else if (value.class === "FUNCTION") {
      const name = lower(value.function_name);
      if (SUMMARISING_AGGREGATES.has(name))
        next = { ...state, summarised: true };
      else if (AGGREGATE_HINTS.has(name)) next = { ...state, revealing: name };
    }
    if (value.class === "COLUMN_REF" && Array.isArray(value.column_names)) {
      const parts = value.column_names.map(lower);
      const column = parts[parts.length - 1];
      if (names.has(column))
        uses.push({
          column,
          summarised: next.summarised && !next.revealing,
          revealing: next.revealing,
          filter: next.filter,
          plain: !next.summarised && !next.revealing && !next.filter,
        });
    }
    for (const child of Object.values(value)) visit(child, next);
  };
  const base = { summarised: false, revealing: null, filter: false };
  for (const [key, child] of Object.entries(select)) {
    if (key === "cte_map") continue;
    const filter = key === "where_clause" || key === "from_table";
    visit(child, { ...base, filter });
  }
  return uses;
}

/** Whether the SELECT's own lists hold an aggregate call. */
function hasAggregate(select: Node) {
  let found = false;
  const visit = (value: unknown) => {
    if (found) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isNode(value)) return;
    if (isSelect(value) || value.type === "SET_OPERATION_NODE") return;
    if (value.class === "WINDOW") return;
    if (
      value.class === "FUNCTION" &&
      AGGREGATE_HINTS.has(lower(value.function_name))
    ) {
      found = true;
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(select.select_list);
  visit(select.having);
  visit(select.modifiers);
  return found;
}

const grouped = (select: Node) =>
  (Array.isArray(select.group_expressions) &&
    select.group_expressions.length > 0) ||
  (typeof select.aggregate_handling === "string" &&
    select.aggregate_handling !== "STANDARD_HANDLING");

/**
 * The SQL whose parsed HAVING the Guard borrows: `true AND count(*) >= k`.
 * DuckDB parses it, so the nodes the Guard adds are DuckDB's own shapes.
 */
export function minimumGroupTemplate(minGroupSize: number) {
  return `select 1 having true and count(*) >= ${Math.max(1, Math.floor(minGroupSize))}`;
}

/** The `count(*) >= k` condition and the AND around it, from the parsed template. */
function templateParts(template: unknown) {
  const select = ((template as Node)?.statements as Node[] | undefined)?.[0]
    ?.node as Node | undefined;
  const having = select?.having as Node | undefined;
  const children = having?.children;
  if (!having || !Array.isArray(children) || children.length !== 2) return null;
  return { conjunction: having, condition: children[1] as Node };
}

/**
 * Checks one parsed statement against the Catalog and the Rules, and returns
 * the statement to run or a refusal that says what to change.
 */
export function guardStatement(input: {
  /** `json_serialize_sql` of the Query. */
  ast: unknown;
  /** `json_serialize_sql` of `minimumGroupTemplate(rules.minGroupSize)`. */
  template: unknown;
  catalog: GuardCatalog;
  rules: GuardRules;
}): GuardVerdict {
  const { catalog, rules } = input;
  const root = input.ast as Node | null;
  if (!isNode(root) || root.error === true) {
    const reason =
      isNode(root) && typeof root.error_message === "string"
        ? root.error_message
        : "it could not be parsed";
    return refuse(
      "query.select_only",
      /only select/i.test(reason)
        ? "A Query is one SELECT. Nothing else runs."
        : `The SQL does not parse: ${reason.slice(0, 300)}`,
    );
  }
  const statements = root.statements;
  if (!Array.isArray(statements) || statements.length !== 1)
    return refuse(
      "query.select_only",
      "A Query is exactly one SELECT statement.",
    );

  const ast = structuredClone(root);
  // DuckDB writes "no location" as 2^64-1, which JSON.parse turns into a float it will not read back.
  walk(ast, (node) => {
    for (const key of ["query_location", "query_location_length"])
      if (key in node && !Number.isSafeInteger(node[key])) node[key] = 0;
    return true;
  });
  const ctes = cteNames(ast);
  const tables = new Set<string>();
  let refusal: GuardRefusal | null = null;

  walk(ast, (node) => {
    if (refusal) return false;
    if (typeof node.type === "string" && REFUSED_REF_TYPES.has(node.type)) {
      refusal = refuse(
        "query.select_only",
        "SHOW, DESCRIBE and SUMMARIZE do not run here. Use list_tables and describe_table.",
      );
      return false;
    }
    if (node.type === "TABLE_FUNCTION") {
      const name = lower((node.function as Node | undefined)?.function_name);
      if (!SAFE_TABLE_FUNCTIONS.has(name)) {
        refusal = refuse(
          "query.no_files",
          `${name || "That table function"}() does not run here: a Query reads Catalog Tables only, never a file.`,
        );
        return false;
      }
    }
    if (node.type === "BASE_TABLE") {
      const table = lower(node.table_name);
      if (lower(node.catalog_name) || lower(node.schema_name)) {
        refusal = refuse(
          "query.unknown_table",
          `Name Tables plainly ("${table}"), without a schema or database.`,
        );
        return false;
      }
      if (ctes.has(table)) return true;
      if (!catalog.tables[table]) {
        refusal = refuse(
          "query.unknown_table",
          `There is no Table "${table}" in the Catalog.`,
        );
        return false;
      }
      if (rules.deniedTables.has(table)) {
        refusal = refuse(
          "access.denied_tables",
          `A Rule denies the Table "${table}". Answer without it.`,
        );
        return false;
      }
      tables.add(table);
    }
    return true;
  });
  if (refusal) return refusal;

  const restrictedTables = [...tables].filter(
    (table) => (rules.restricted.get(table)?.size ?? 0) > 0,
  );
  if (restrictedTables.length === 0)
    return {
      ok: true,
      ast,
      tables: [...tables].sort(),
      restrictedUsed: [],
      guardedSelects: 0,
      rewritten: false,
    };

  const parts = templateParts(input.template);
  if (!parts)
    return refuse(
      "access.restricted_columns",
      "The minimum group size could not be applied, so the Query was not run.",
    );

  const restrictedUsed = new Set<string>();
  let guardedSelects = 0;
  const k = rules.minGroupSize;
  const allowed = "avg, sum, count, median, quantile, stddev";

  walk(ast, (node) => {
    if (refusal) return false;
    if (!isSelect(node)) return true;
    const direct = directTables(node, ctes).filter((ref) =>
      restrictedTables.includes(ref.table),
    );
    if (direct.length === 0) return true;
    const names = new Set<string>();
    for (const ref of direct)
      for (const column of rules.restricted.get(ref.table) ?? [])
        names.add(column.toLowerCase());
    const label = direct.map((ref) => ref.table).join(", ");

    // A whole row at once: `*`, `t.*`, COLUMNS(...), `#1`, or the Table's own name as a value.
    let wholeRow: string | null = null;
    const aliases = new Set(direct.flatMap((ref) => [ref.table, ref.alias]));
    const scan = (value: unknown) => {
      if (wholeRow) return;
      if (Array.isArray(value)) {
        for (const item of value) scan(item);
        return;
      }
      if (!isNode(value)) return;
      if (isSelect(value) || value.type === "SET_OPERATION_NODE") return;
      if (value.class === "STAR") {
        const excluded = new Set(
          [
            ...((value.exclude_list as unknown[]) ?? []),
            ...((value.qualified_exclude_list as unknown[]) ?? []),
          ].map((item) => {
            if (typeof item === "string") return item.toLowerCase();
            const names = (item as Node)?.column_names ?? (item as Node)?.path;
            return Array.isArray(names)
              ? lower(names[names.length - 1])
              : lower((item as Node)?.name);
          }),
        );
        const covers = [...names].every((name) => excluded.has(name));
        if (!covers || value.columns === true || value.expr) wholeRow = "*";
        return;
      }
      if (value.class === "POSITIONAL_REFERENCE") {
        wholeRow = "a positional reference (#n)";
        return;
      }
      if (
        value.class === "COLUMN_REF" &&
        Array.isArray(value.column_names) &&
        value.column_names.length === 1 &&
        aliases.has(lower(value.column_names[0])) &&
        !names.has(lower(value.column_names[0]))
      ) {
        wholeRow = `the whole row "${value.column_names[0]}"`;
        return;
      }
      for (const child of Object.values(value)) scan(child);
    };
    for (const [key, child] of Object.entries(node))
      if (key !== "cte_map" && key !== "from_table") scan(child);
    if (wholeRow) {
      refusal = refuse(
        "access.restricted_columns",
        `${label} has Restricted columns (${[...names].join(", ")}), so ${wholeRow} cannot be selected from it. Name the columns you need.`,
      );
      return false;
    }

    const uses = usesIn(node, names);
    if (uses.length === 0) return true;
    const revealing = uses.find((use) => use.revealing);
    if (revealing) {
      refusal = refuse(
        "access.restricted_columns",
        `${revealing.column} is Restricted: ${revealing.revealing}() could return one row's value. Use ${allowed}.`,
      );
      return false;
    }
    const aggregate = grouped(node) || hasAggregate(node);
    const plain = uses.find((use) => use.plain);
    if (!aggregate || (plain && !grouped(node))) {
      refusal = refuse(
        "access.restricted_columns",
        `${(plain ?? uses[0]).column} is Restricted: it is never returned row by row. Aggregate it (${allowed}) over groups of at least ${k} rows.`,
      );
      return false;
    }
    for (const use of uses)
      for (const ref of direct)
        if (rules.restricted.get(ref.table)?.has(use.column))
          restrictedUsed.add(`${ref.table}.${use.column}`);
    // Every group this SELECT returns must hold at least k rows.
    const condition = structuredClone(parts.condition);
    if (isNode(node.having)) {
      const both = structuredClone(parts.conjunction);
      both.children = [node.having, condition];
      node.having = both;
    } else node.having = condition;
    guardedSelects += 1;
    return true;
  });
  if (refusal) return refusal;

  return {
    ok: true,
    ast,
    tables: [...tables].sort(),
    restrictedUsed: [...restrictedUsed].sort(),
    guardedSelects,
    rewritten: guardedSelects > 0,
  };
}

/** The `$name` Parameters a parsed statement uses. */
export function parametersOf(ast: unknown) {
  const names = new Set<string>();
  walk(ast, (node) => {
    if (node.class === "PARAMETER" && typeof node.identifier === "string")
      names.add(node.identifier);
    return true;
  });
  return [...names].sort();
}
