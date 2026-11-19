import { z } from "zod";
import { LIMITS } from "./limits";

/**
 * The View grammar, version 1 (`canvas.view/1`): the typed description every
 * View is written in. The Analyst fills it in; trusted code (the App) draws
 * it. There is no free-form HTML or script anywhere in it (ADR 0031).
 *
 * The App imports only the types of this file, never zod.
 */
export const VIEW_GRAMMAR = "canvas.view/1";

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const FIELD = z
  .string()
  .min(1)
  .max(64)
  .describe("A column of the Query's result, exactly as named there");

// Parameters and Controls ----------------------------------------------------------------

export const paramSchema = z.discriminatedUnion("type", [
  z.object({
    name: z.string().regex(NAME),
    type: z.literal("number"),
    value: z.number().finite(),
  }),
  z.object({
    name: z.string().regex(NAME),
    type: z.literal("date"),
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    name: z.string().regex(NAME),
    type: z.literal("text"),
    value: z.string().max(120),
  }),
]);
export type Param = z.infer<typeof paramSchema>;
export type ParamValue = Param["value"];
export type ParamValues = Record<string, ParamValue>;

export const controlSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("slider"),
    param: z.string().regex(NAME),
    label: z.string().min(1).max(60),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().finite(),
    unit: z.string().max(12).optional(),
  }),
  z.object({
    kind: z.literal("select"),
    param: z.string().regex(NAME),
    label: z.string().min(1).max(60),
    options: z
      .array(
        z.object({
          value: z.union([z.string().max(120), z.number().finite()]),
          label: z.string().min(1).max(60),
        }),
      )
      .min(2)
      .max(40),
  }),
  z.object({
    kind: z.literal("date_range"),
    from: z.string().regex(NAME),
    to: z.string().regex(NAME),
    label: z.string().min(1).max(60),
    min: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    max: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);
export type Control = z.infer<typeof controlSchema>;

// The Query ------------------------------------------------------------------------------

const SQL = z.string().min(1).max(LIMITS.queryChars);

export const querySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sql"),
    sql: SQL.describe(
      "One DuckDB SELECT over Catalog Tables. Parameters are written $name.",
    ),
  }),
  z.object({
    kind: z.literal("code"),
    inputs: z
      .array(
        z.object({
          name: z.string().regex(NAME),
          sql: SQL,
        }),
      )
      .min(1)
      .max(4)
      .describe(
        "Guarded SELECTs whose results the code reads as canvas.inputs[name]",
      ),
    code: z
      .string()
      .min(1)
      .max(LIMITS.queryChars)
      .describe(
        "Python. Reads canvas.inputs and canvas.params, ends with canvas.table(columns, rows).",
      ),
  }),
]);
export type ViewQuery = z.infer<typeof querySchema>;

// Encodings ------------------------------------------------------------------------------

export const FORMATS = [
  "number",
  "integer",
  "compact",
  "percent",
  "currency",
  "date",
  "datetime",
  "text",
] as const;
export type Format = (typeof FORMATS)[number];

const axis = z.object({
  field: FIELD,
  label: z.string().max(60).optional(),
  unit: z.string().max(12).optional(),
  format: z.enum(FORMATS).optional(),
});

const xAxis = axis.extend({
  type: z
    .enum(["time", "number", "category"])
    .describe(
      "time for dates and timestamps, number for a measure, category for names",
    ),
});

const yAxis = axis.extend({
  /** Bars must start at zero (a Rule); a line may zoom in. */
  zero: z.boolean().optional(),
});

const series = z
  .object({ field: FIELD, label: z.string().max(60).optional() })
  .describe(
    "Long format: one row per (x, series). The field's values name the series.",
  );

const brush = z
  .object({
    from: z.string().regex(NAME),
    to: z.string().regex(NAME),
  })
  .describe(
    "Dragging across x sets these two Parameters; give them to Linked Views too.",
  );

const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const cartesian = {
  x: xAxis,
  y: yAxis,
  series: series.optional(),
  /** Leave out to use the validated default palette. Checked by a Rule. */
  colors: z.array(HEX).max(8).optional(),
  brush: brush.optional(),
};

export const encodingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), ...cartesian }),
  z.object({ kind: z.literal("area"), ...cartesian }),
  z.object({
    kind: z.literal("bar"),
    ...cartesian,
    stacked: z.boolean().optional(),
    horizontal: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("scatter"),
    x: xAxis,
    y: yAxis,
    series: series.optional(),
    size: axis.optional(),
    label: z.object({ field: FIELD }).optional(),
    colors: z.array(HEX).max(8).optional(),
  }),
  z.object({
    kind: z.literal("heatmap"),
    x: axis,
    y: axis,
    value: axis,
  }),
  z.object({
    kind: z.literal("pie"),
    category: axis,
    value: axis,
    colors: z.array(HEX).max(8).optional(),
  }),
  z.object({
    kind: z.literal("table"),
    columns: z
      .array(
        z.object({
          field: FIELD,
          label: z.string().max(60).optional(),
          format: z.enum(FORMATS).optional(),
          unit: z.string().max(12).optional(),
          /** Draws a small bar behind the number, scaled to the column. */
          bar: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(12),
    sort: z
      .object({ field: FIELD, descending: z.boolean().optional() })
      .optional(),
    /** Drill-down: clicking a row sets this Parameter to the row's value of `field`. */
    drill: z.object({ param: z.string().regex(NAME), field: FIELD }).optional(),
  }),
  z.object({
    kind: z.literal("map"),
    /** A column holding Meridia region codes. */
    region: z.object({ field: FIELD }),
    value: axis,
    /** Clicking a region sets this Parameter to its code. */
    drill: z.object({ param: z.string().regex(NAME) }).optional(),
  }),
  z.object({
    kind: z.literal("stat"),
    /** Each tile reads one column of the result's first row. */
    tiles: z
      .array(
        z.object({
          field: FIELD,
          label: z.string().min(1).max(60),
          format: z.enum(FORMATS).optional(),
          unit: z.string().max(12).optional(),
          /** A column holding the change against a baseline, shown beside it. */
          delta: z
            .object({
              field: FIELD,
              format: z.enum(FORMATS).optional(),
              /** Whether a rise is good news (colours the arrow). */
              upIsGood: z.boolean().optional(),
            })
            .optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
]);
export type Encoding = z.infer<typeof encodingSchema>;
export type ViewKind = Encoding["kind"];
export const VIEW_KINDS = [
  "line",
  "area",
  "bar",
  "scatter",
  "heatmap",
  "pie",
  "table",
  "map",
  "stat",
] as const satisfies readonly ViewKind[];

// Annotations and Claims -----------------------------------------------------------------

const scalar = z.union([z.string().max(120), z.number().finite()]);

export const annotationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("point"),
    x: scalar,
    /** Which series, when the chart has several. */
    series: z.string().max(120).optional(),
    label: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal("band"),
    from: scalar,
    to: scalar,
    label: z.string().min(1).max(80),
  }),
  z.object({
    kind: z.literal("line"),
    y: z.number().finite(),
    label: z.string().min(1).max(80),
  }),
]);
export type Annotation = z.infer<typeof annotationSchema>;

export const CLAIM_AGGREGATES = [
  "value",
  "max",
  "min",
  "sum",
  "avg",
  "count",
  "first",
  "last",
] as const;
export type ClaimAggregate = (typeof CLAIM_AGGREGATES)[number];

export const claimSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,24}$/),
  /** What the number is, in a few words: "peak national load". */
  label: z.string().min(1).max(80),
  /** The number as the Finding states it. */
  value: z.number().finite(),
  unit: z.string().max(12).optional(),
  format: z.enum(FORMATS).optional(),
  /** Where code finds it in the View's rows. */
  from: z.object({
    column: FIELD,
    aggregate: z.enum(CLAIM_AGGREGATES),
    /** Keep only rows where each column equals the value. */
    where: z.record(z.string().max(64), scalar).optional(),
  }),
});
export type Claim = z.infer<typeof claimSchema>;

// The View -------------------------------------------------------------------------------

export const viewSpecSchema = z
  .object({
    grammar: z.literal(VIEW_GRAMMAR),
    title: z.string().min(1).max(120),
    subtitle: z.string().max(160).optional(),
    /** The note in words. Every number in it must be a Claim. */
    finding: z.string().max(700),
    claims: z.array(claimSchema).max(8).default([]),
    query: querySchema,
    params: z.array(paramSchema).max(8).default([]),
    controls: z.array(controlSchema).max(4).default([]),
    encoding: encodingSchema,
    annotations: z.array(annotationSchema).max(6).default([]),
  })
  .superRefine((spec, ctx) => {
    const names = new Set<string>();
    for (const param of spec.params) {
      if (names.has(param.name))
        ctx.addIssue({
          code: "custom",
          message: `Parameter "${param.name}" is declared twice.`,
          path: ["params"],
        });
      names.add(param.name);
    }
    const need = (name: string, where: string) => {
      if (!names.has(name))
        ctx.addIssue({
          code: "custom",
          message: `${where} names Parameter "${name}", which the View does not declare.`,
          path: ["params"],
        });
    };
    for (const control of spec.controls) {
      if (control.kind === "date_range") {
        need(control.from, "A date range");
        need(control.to, "A date range");
      } else need(control.param, `The ${control.kind}`);
    }
    const encoding = spec.encoding;
    if ("brush" in encoding && encoding.brush) {
      need(encoding.brush.from, "The Brush");
      need(encoding.brush.to, "The Brush");
    }
    if (
      (encoding.kind === "table" || encoding.kind === "map") &&
      encoding.drill
    )
      need(encoding.drill.param, "The drill-down");
    const ids = new Set<string>();
    for (const claim of spec.claims) {
      if (ids.has(claim.id))
        ctx.addIssue({
          code: "custom",
          message: `Claim "${claim.id}" is declared twice.`,
          path: ["claims"],
        });
      ids.add(claim.id);
    }
  });
export type ViewSpec = z.infer<typeof viewSpecSchema>;

/** The Parameters' current values, by name, starting from the spec's own. */
export function defaultParams(spec: Pick<ViewSpec, "params">): ParamValues {
  return Object.fromEntries(
    spec.params.map((param) => [param.name, param.value]),
  );
}

/**
 * New values laid over the current ones, each checked against its
 * Parameter's type and, where a Control bounds it, that bound. Unknown names
 * and bad values are reported, never applied.
 */
export function mergeParams(
  spec: Pick<ViewSpec, "params" | "controls">,
  current: ParamValues,
  changes: Record<string, unknown>,
): { values: ParamValues; errors: string[] } {
  const values = { ...defaultParams(spec), ...current };
  const errors: string[] = [];
  for (const [name, value] of Object.entries(changes)) {
    const param = spec.params.find((item) => item.name === name);
    if (!param) {
      errors.push(`This View has no Parameter "${name}".`);
      continue;
    }
    if (param.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`"${name}" takes a number.`);
        continue;
      }
      const slider = spec.controls.find(
        (control) => control.kind === "slider" && control.param === name,
      );
      values[name] =
        slider?.kind === "slider"
          ? Math.min(slider.max, Math.max(slider.min, value))
          : value;
    } else if (param.type === "date") {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        errors.push(`"${name}" takes a date (YYYY-MM-DD).`);
        continue;
      }
      values[name] = value;
    } else {
      if (typeof value !== "string" && typeof value !== "number") {
        errors.push(`"${name}" takes text.`);
        continue;
      }
      values[name] = String(value).slice(0, 120);
    }
  }
  return { values, errors };
}

// A View's data --------------------------------------------------------------------------

export type Cell = string | number | boolean | null;

export type ResultColumn = {
  name: string;
  /** The DuckDB type, lower-cased: "double", "varchar", "timestamp", "date"… */
  type: string;
};

/** What a Query returned: at most the row cap, with the true count beside it. */
export type QueryResult = {
  columns: ResultColumn[];
  rows: Cell[][];
  /** Rows the Query produced before the cap. */
  rowCount: number;
  truncated: boolean;
  ms: number;
};

export function columnIndex(
  result: Pick<QueryResult, "columns">,
  name: string,
) {
  return result.columns.findIndex((column) => column.name === name);
}

/** The fields a spec reads from its result, for checking they exist. */
export function fieldsOf(spec: Pick<ViewSpec, "encoding" | "claims">) {
  const fields = new Set<string>();
  const add = (item?: { field: string }) => {
    if (item) fields.add(item.field);
  };
  const encoding = spec.encoding;
  switch (encoding.kind) {
    case "line":
    case "area":
    case "bar":
      add(encoding.x);
      add(encoding.y);
      add(encoding.series);
      break;
    case "scatter":
      add(encoding.x);
      add(encoding.y);
      add(encoding.series);
      add(encoding.size);
      add(encoding.label);
      break;
    case "heatmap":
      add(encoding.x);
      add(encoding.y);
      add(encoding.value);
      break;
    case "pie":
      add(encoding.category);
      add(encoding.value);
      break;
    case "table":
      for (const column of encoding.columns) add(column);
      add(encoding.sort);
      add(encoding.drill);
      break;
    case "map":
      add(encoding.region);
      add(encoding.value);
      break;
    case "stat":
      for (const tile of encoding.tiles) {
        add(tile);
        add(tile.delta);
      }
      break;
  }
  for (const claim of spec.claims) {
    fields.add(claim.from.column);
    for (const column of Object.keys(claim.from.where ?? {}))
      fields.add(column);
  }
  return [...fields];
}
