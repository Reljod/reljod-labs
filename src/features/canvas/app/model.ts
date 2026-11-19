import type { ViewRecord } from "../domain/payload";
import type {
  Cell,
  Encoding,
  ParamValues,
  QueryResult,
  ViewSpec,
} from "../domain/view";
import { parseTime, type TimeUnit, timeUnitOf, toNumber } from "./format";

/** Turning a View's rows into what a chart draws. Pure. */

export type XType = "time" | "number" | "category";

export type Frame = {
  xType: XType;
  /** Distinct x values in drawing order: milliseconds, numbers or names. */
  xs: (number | string)[];
  /** The rows' own text for each x, for matching a Parameter or an Annotation. */
  raw: string[];
  timeUnit: TimeUnit;
  series: { name: string; values: (number | null)[] }[];
};

export const column = (result: Pick<QueryResult, "columns">, field: string) =>
  result.columns.findIndex((item) => item.name === field);

/** The fields an encoding and its Claims read that the result does not have. */
export function missingFields(
  result: Pick<QueryResult, "columns">,
  fields: readonly string[],
) {
  return fields.filter((field) => column(result, field) < 0);
}

/** The fields an encoding reads (the App's own copy of `fieldsOf`, types only). */
export function encodingFields(encoding: Encoding): string[] {
  const fields: (string | undefined)[] = [];
  switch (encoding.kind) {
    case "line":
    case "area":
    case "bar":
      fields.push(encoding.x.field, encoding.y.field, encoding.series?.field);
      break;
    case "scatter":
      fields.push(
        encoding.x.field,
        encoding.y.field,
        encoding.series?.field,
        encoding.size?.field,
        encoding.label?.field,
      );
      break;
    case "heatmap":
      fields.push(encoding.x.field, encoding.y.field, encoding.value.field);
      break;
    case "pie":
      fields.push(encoding.category.field, encoding.value.field);
      break;
    case "table":
      for (const item of encoding.columns) fields.push(item.field);
      fields.push(encoding.drill?.field);
      break;
    case "map":
      fields.push(encoding.region.field, encoding.value.field);
      break;
    case "stat":
      for (const tile of encoding.tiles)
        fields.push(tile.field, tile.delta?.field);
      break;
  }
  return [...new Set(fields.filter((field): field is string => !!field))];
}

const SINGLE = "";

/**
 * Long rows (one per x and series) as a frame: the distinct x values in
 * order and, per series, one value for each of them (null where a series has
 * no row). Time and number x are sorted; categories keep the rows' order.
 */
export function buildFrame(
  result: QueryResult,
  encoding: {
    x: { field: string; type: XType };
    y: { field: string };
    series?: { field: string };
  },
): Frame {
  const xAt = column(result, encoding.x.field);
  const yAt = column(result, encoding.y.field);
  const seriesAt = encoding.series ? column(result, encoding.series.field) : -1;
  const xType = encoding.x.type;
  const keys = new Map<number | string, number>();
  const xs: (number | string)[] = [];
  const raw: string[] = [];
  const names: string[] = [];
  const bySeries = new Map<string, Map<number | string, number>>();
  for (const row of result.rows) {
    const cell = row[xAt];
    let key: number | string | null;
    if (xType === "time") key = parseTime(cell);
    else if (xType === "number") key = toNumber(cell);
    else key = cell === null || cell === undefined ? null : String(cell);
    if (key === null) continue;
    if (!keys.has(key)) {
      keys.set(key, xs.length);
      xs.push(key);
      raw.push(String(cell));
    }
    const name = seriesAt >= 0 ? String(row[seriesAt] ?? "–") : SINGLE;
    let values = bySeries.get(name);
    if (!values) {
      values = new Map();
      bySeries.set(name, values);
      names.push(name);
    }
    const value = toNumber(row[yAt]);
    if (value !== null) values.set(key, value);
  }
  let order = xs.map((_, index) => index);
  if (xType !== "category")
    order = order.sort((a, b) => (xs[a] as number) - (xs[b] as number));
  const sortedXs = order.map((index) => xs[index]);
  return {
    xType,
    xs: sortedXs,
    raw: order.map((index) => raw[index]),
    timeUnit: xType === "time" ? timeUnitOf(sortedXs as number[]) : "day",
    series: names.map((name) => {
      const values = bySeries.get(name);
      return {
        name,
        values: sortedXs.map((key) => values?.get(key) ?? null),
      };
    }),
  };
}

/** The smallest and largest finite number in a list of lists. */
export function extent(lists: Iterable<Iterable<number | null>>) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const list of lists)
    for (const value of list) {
      if (value === null || !Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  return min <= max ? ([min, max] as const) : null;
}

/** The spec's own Parameter values, by name. */
export function specParams(spec: Pick<ViewSpec, "params">): ParamValues {
  const values: ParamValues = {};
  for (const param of spec.params) values[param.name] = param.value;
  return values;
}

/** The Parameters whose current value is not the spec's own. */
export function changedParams(
  spec: Pick<ViewSpec, "params">,
  current: ParamValues,
) {
  return spec.params.filter(
    (param) =>
      current[param.name] !== undefined && current[param.name] !== param.value,
  );
}

/** A row's cells for a table: sorted copies of the rows by one column. */
export function sortRows(
  rows: Cell[][],
  at: number,
  descending: boolean,
): Cell[][] {
  const sign = descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const [left, right] = [a[at], b[at]];
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    if (typeof left === "number" && typeof right === "number")
      return (left - right) * sign;
    const [first, second] = [toNumber(left), toNumber(right)];
    if (first !== null && second !== null && first !== second)
      return (first - second) * sign;
    return String(left).localeCompare(String(right)) * sign;
  });
}

/** The eyebrow over a View's title: "LINE · 2,184 ROWS". */
export function eyebrowOf(view: Pick<ViewRecord, "spec" | "result">) {
  const rows = view.result.rowCount;
  return `${view.spec.encoding.kind} · ${rows.toLocaleString("en-US")} ${rows === 1 ? "row" : "rows"}`;
}
