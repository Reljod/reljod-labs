import { LIMITS } from "./limits";

/**
 * Canvas's Rules (ADR 0015 shape): each is a sentence with typed Parameters
 * and a switch. The Rulebook an Owner edits is only values; what a Rule does
 * is code: the Guard (`guard.ts`), the verification (`verify.ts`) and the
 * chart checks (`chart-checks.ts`) read these values and nothing else.
 */

export type RuleGroup = "verification" | "access" | "query" | "chart";

export type RuleId =
  | "verify.tolerance"
  | "verify.unbacked_figures"
  | "access.restricted_columns"
  | "access.denied_tables"
  | "query.max_rows"
  | "query.max_seconds"
  | "chart.pie_max_slices"
  | "chart.bars_start_at_zero"
  | "chart.max_series"
  | "chart.colour_blind_safe";

export type RuleParamDef =
  | {
      kind: "number";
      label: string;
      min: number;
      max: number;
      step: number;
      unit?: string;
    }
  | {
      /** `table.column` names. */
      kind: "columns";
      label: string;
    }
  | { kind: "tables"; label: string };

export type RuleValue = number | string[];

export type RuleDef = {
  id: RuleId;
  group: RuleGroup;
  title: string;
  /** The Rule as a sentence; `{name}` stands for a Parameter. */
  sentence: string;
  why: string;
  /** What breaking it does: the Query or View is refused, or the View is Flagged. */
  outcome: "block" | "flag";
  /** Rules the product cannot work without stay on. */
  canDisable: boolean;
  params: Record<string, RuleParamDef>;
  defaults: Record<string, RuleValue>;
};

export const RULE_DEFS: readonly RuleDef[] = [
  {
    id: "verify.tolerance",
    group: "verification",
    title: "Narrated numbers must match the data",
    sentence:
      "A Claim is Verified when it is within {percent}% of the value recomputed from the View's rows.",
    why: "A model can misread its own result. Code recomputes every number the Finding states.",
    outcome: "flag",
    canDisable: false,
    params: {
      percent: {
        kind: "number",
        label: "Tolerance",
        min: 0,
        max: 10,
        step: 0.1,
        unit: "%",
      },
    },
    defaults: { percent: 0.5 },
  },
  {
    id: "verify.unbacked_figures",
    group: "verification",
    title: "No figure without a Claim",
    sentence:
      "A number written in a Finding that no Claim backs flags the View.",
    why: "A figure nobody can trace is the one that ends up in a slide.",
    outcome: "flag",
    canDisable: true,
    params: {},
    defaults: {},
  },
  {
    id: "access.restricted_columns",
    group: "access",
    title: "Restricted columns are only ever aggregated",
    sentence:
      "These columns are never returned row by row; a Query may aggregate them over groups of at least {minGroupSize} rows.",
    why: "Household income and age are personal. A group smaller than the minimum could single somebody out.",
    outcome: "block",
    canDisable: false,
    params: {
      columns: { kind: "columns", label: "Restricted columns" },
      minGroupSize: {
        kind: "number",
        label: "Minimum group size",
        min: 2,
        max: 1000,
        step: 1,
        unit: "rows",
      },
    },
    defaults: {
      columns: [
        "household_survey.household_id",
        "household_survey.monthly_income_mdc",
        "household_survey.respondent_age",
      ],
      minGroupSize: 10,
    },
  },
  {
    id: "access.denied_tables",
    group: "access",
    title: "Tables the Analyst may not read",
    sentence: "A Query that reads one of these Tables is refused.",
    why: "Not every Table is for every question. Take one away and the Analyst must answer without it.",
    outcome: "block",
    canDisable: true,
    params: { tables: { kind: "tables", label: "Denied Tables" } },
    defaults: { tables: [] },
  },
  {
    id: "query.max_rows",
    group: "query",
    title: "Rows a Query returns",
    sentence:
      "A Query returns at most {rows} rows; a View built on more says it was cut.",
    why: "A chart of 400,000 points says nothing. Aggregate in the Query.",
    outcome: "flag",
    canDisable: false,
    params: {
      rows: {
        kind: "number",
        label: "Row cap",
        min: 100,
        max: LIMITS.rowsReturned,
        step: 100,
        unit: "rows",
      },
    },
    defaults: { rows: 2_000 },
  },
  {
    id: "query.max_seconds",
    group: "query",
    title: "Time a Query may take",
    sentence: "A Query or a piece of code is stopped after {seconds} seconds.",
    why: "A Control should answer while the person is still looking at it.",
    outcome: "block",
    canDisable: false,
    params: {
      seconds: {
        kind: "number",
        label: "Time limit",
        min: 2,
        max: LIMITS.runSeconds,
        step: 1,
        unit: "s",
      },
    },
    defaults: { seconds: 20 },
  },
  {
    id: "chart.pie_max_slices",
    group: "chart",
    title: "No pie above a few slices",
    sentence: "A pie with more than {slices} slices is refused; use bars.",
    why: "Past a handful of slices nobody can compare the angles.",
    outcome: "block",
    canDisable: true,
    params: {
      slices: {
        kind: "number",
        label: "Most slices",
        min: 2,
        max: 12,
        step: 1,
      },
    },
    defaults: { slices: 5 },
  },
  {
    id: "chart.bars_start_at_zero",
    group: "chart",
    title: "Bars start at zero",
    sentence: "A bar chart whose value axis does not start at zero is refused.",
    why: "A bar's length is its value. Cut the axis and a 2% gap looks like a doubling.",
    outcome: "block",
    canDisable: true,
    params: {},
    defaults: {},
  },
  {
    id: "chart.max_series",
    group: "chart",
    title: "A chart holds a few series",
    sentence:
      "A chart with more than {series} series is refused; fold the rest into Other or use a table.",
    why: "There are only so many colours a reader can tell apart.",
    outcome: "block",
    canDisable: true,
    params: {
      series: {
        kind: "number",
        label: "Most series",
        min: 2,
        max: 8,
        step: 1,
      },
    },
    defaults: { series: 8 },
  },
  {
    id: "chart.colour_blind_safe",
    group: "chart",
    title: "Colours a colour-blind reader can tell apart",
    sentence:
      "Neighbouring series colours must differ by at least {deltaE} (OKLab, as protanopia and deuteranopia see them).",
    why: "One reader in twelve cannot tell red from green. The default palette passes; a custom one is measured.",
    outcome: "block",
    canDisable: true,
    params: {
      deltaE: {
        kind: "number",
        label: "Least difference",
        min: 4,
        max: 20,
        step: 0.5,
      },
    },
    defaults: { deltaE: 8 },
  },
];

export const RULE_GROUPS: { id: RuleGroup; title: string }[] = [
  { id: "verification", title: "Verification" },
  { id: "access", title: "What the Analyst may read" },
  { id: "query", title: "Query limits" },
  { id: "chart", title: "Chart rules" },
];

export function ruleDef(id: string): RuleDef | undefined {
  return RULE_DEFS.find((rule) => rule.id === id);
}

/** One Rule's values in a Rulebook. */
export type RuleState = {
  enabled: boolean;
  params: Record<string, RuleValue>;
};

/** An Owner's Rules at one Version: only values. */
export type Rulebook = Record<RuleId, RuleState>;

export function defaultRulebook(): Rulebook {
  return Object.fromEntries(
    RULE_DEFS.map((rule) => [
      rule.id,
      {
        enabled: true,
        params: structuredClone(rule.defaults) as Record<string, RuleValue>,
      },
    ]),
  ) as Rulebook;
}

export const DEFAULT_RULEBOOK_VERSION = 0;

export type RuleEdit = {
  id: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
};

export type RuleEditError = { id: string; param?: string; message: string };

/** What a `table.column` or a Table name must be one of, to be accepted in a Rule. */
export type KnownCatalog = { tables: Record<string, readonly string[]> };

/**
 * Applies edits to a Rulebook. Every value is checked against the Rule's own
 * schema (type, range, a real Table or column), so a bad edit is refused
 * where it was made and the Rulebook that is saved is always usable.
 */
export function applyRuleEdits(
  current: Rulebook,
  edits: RuleEdit[],
  catalog: KnownCatalog,
): { rulebook: Rulebook; errors: RuleEditError[]; changed: RuleId[] } {
  const rulebook = structuredClone(current);
  const errors: RuleEditError[] = [];
  const changed = new Set<RuleId>();
  for (const edit of edits) {
    const def = ruleDef(edit.id);
    if (!def) {
      errors.push({ id: edit.id, message: `There is no Rule "${edit.id}".` });
      continue;
    }
    const state = rulebook[def.id];
    if (edit.enabled !== undefined && edit.enabled !== state.enabled) {
      if (!edit.enabled && !def.canDisable) {
        errors.push({
          id: def.id,
          message: `"${def.title}" cannot be switched off.`,
        });
      } else {
        state.enabled = edit.enabled;
        changed.add(def.id);
      }
    }
    for (const [name, raw] of Object.entries(edit.params ?? {})) {
      const param = def.params[name];
      if (!param) {
        errors.push({
          id: def.id,
          param: name,
          message: `"${def.title}" has no Parameter "${name}".`,
        });
        continue;
      }
      const checked = checkValue(param, raw, catalog);
      if ("error" in checked) {
        errors.push({ id: def.id, param: name, message: checked.error });
        continue;
      }
      if (JSON.stringify(state.params[name]) !== JSON.stringify(checked.value)) {
        state.params[name] = checked.value;
        changed.add(def.id);
      }
    }
  }
  return { rulebook, errors, changed: [...changed] };
}

function checkValue(
  param: RuleParamDef,
  raw: unknown,
  catalog: KnownCatalog,
): { value: RuleValue } | { error: string } {
  if (param.kind === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw))
      return { error: `${param.label} takes a number.` };
    if (raw < param.min || raw > param.max)
      return {
        error: `${param.label} must be between ${param.min} and ${param.max}.`,
      };
    return { value: raw };
  }
  if (
    !Array.isArray(raw) ||
    raw.length > 60 ||
    raw.some((item) => typeof item !== "string")
  )
    return { error: `${param.label} takes a list of names.` };
  const names = [...new Set((raw as string[]).map((item) => item.trim()))]
    .filter(Boolean)
    .sort();
  for (const name of names) {
    if (param.kind === "tables") {
      if (!catalog.tables[name])
        return { error: `There is no Table "${name}".` };
    } else {
      const [table, column, ...rest] = name.split(".");
      if (!table || !column || rest.length > 0)
        return { error: `Write a column as table.column: "${name}".` };
      if (!catalog.tables[table]?.includes(column))
        return { error: `There is no column "${name}".` };
    }
  }
  return { value: names };
}

/** A Rulebook read back from the database: anything missing or malformed falls back to the Default. */
export function normaliseRulebook(value: unknown): Rulebook {
  const base = defaultRulebook();
  if (!value || typeof value !== "object") return base;
  for (const def of RULE_DEFS) {
    const saved = (value as Record<string, unknown>)[def.id] as
      | Partial<RuleState>
      | undefined;
    if (!saved || typeof saved !== "object") continue;
    if (typeof saved.enabled === "boolean")
      base[def.id].enabled = def.canDisable ? saved.enabled : true;
    for (const [name, param] of Object.entries(def.params)) {
      const raw = saved.params?.[name];
      if (param.kind === "number") {
        if (typeof raw === "number" && raw >= param.min && raw <= param.max)
          base[def.id].params[name] = raw;
      } else if (
        Array.isArray(raw) &&
        raw.every((item) => typeof item === "string")
      ) {
        base[def.id].params[name] = raw as string[];
      }
    }
  }
  return base;
}

// What the code reads ----------------------------------------------------------------------

const number = (rulebook: Rulebook, id: RuleId, name: string) =>
  rulebook[id].params[name] as number;
const list = (rulebook: Rulebook, id: RuleId, name: string) =>
  rulebook[id].params[name] as string[];

/** The Rulebook as the Guard and the checks use it. Every value comes from here, never a constant. */
export function settings(rulebook: Rulebook) {
  const restricted = new Map<string, Set<string>>();
  for (const name of list(rulebook, "access.restricted_columns", "columns")) {
    const [table, column] = name.split(".");
    if (!restricted.has(table)) restricted.set(table, new Set());
    restricted.get(table)?.add(column);
  }
  return {
    tolerancePct: number(rulebook, "verify.tolerance", "percent"),
    flagUnbackedFigures: rulebook["verify.unbacked_figures"].enabled,
    restricted,
    minGroupSize: number(
      rulebook,
      "access.restricted_columns",
      "minGroupSize",
    ),
    deniedTables: new Set(
      rulebook["access.denied_tables"].enabled
        ? list(rulebook, "access.denied_tables", "tables")
        : [],
    ),
    maxRows: Math.min(
      LIMITS.rowsReturned,
      number(rulebook, "query.max_rows", "rows"),
    ),
    maxSeconds: Math.min(
      LIMITS.runSeconds,
      number(rulebook, "query.max_seconds", "seconds"),
    ),
    pieMaxSlices: rulebook["chart.pie_max_slices"].enabled
      ? number(rulebook, "chart.pie_max_slices", "slices")
      : null,
    barsStartAtZero: rulebook["chart.bars_start_at_zero"].enabled,
    maxSeries: rulebook["chart.max_series"].enabled
      ? number(rulebook, "chart.max_series", "series")
      : null,
    minCvdDeltaE: rulebook["chart.colour_blind_safe"].enabled
      ? number(rulebook, "chart.colour_blind_safe", "deltaE")
      : null,
  };
}
export type RuleSettings = ReturnType<typeof settings>;

/** A Rule's sentence with its current values written in. */
export function sentenceOf(def: RuleDef, state: RuleState) {
  return def.sentence.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = state.params[name];
    return Array.isArray(value) ? value.join(", ") : String(value ?? "?");
  });
}

/** The Rules as text the Analyst reads at the start of every Question. */
export function rulebookText(rulebook: Rulebook, version: number) {
  const lines = [`Rulebook v${version}. Code enforces these; you cannot waive them.`];
  for (const def of RULE_DEFS) {
    const state = rulebook[def.id];
    if (!state.enabled) continue;
    let line = `- ${sentenceOf(def, state)}`;
    if (def.id === "access.restricted_columns")
      line += ` Restricted: ${(state.params.columns as string[]).join(", ") || "none"}.`;
    if (def.id === "access.denied_tables")
      line += ` Denied: ${(state.params.tables as string[]).join(", ") || "none"}.`;
    lines.push(line);
  }
  return lines.join("\n");
}

/** What a check returns when a Rule is broken. Only code makes one. */
export type CheckFinding = {
  rule: RuleId | "view.fields" | "view.shape";
  outcome: "block" | "flag";
  message: string;
};
