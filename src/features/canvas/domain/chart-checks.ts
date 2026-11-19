import { PALETTE, worstAdjacentPair } from "./palette";
import type { CheckFinding, RuleSettings } from "./rules";
import { columnIndex, fieldsOf, type QueryResult, type ViewSpec } from "./view";

/**
 * The chart Rules, applied by code to every View spec and its rows. Each
 * check is a pure function of the spec, the result and the Rule's values, and
 * returns Check findings; a `block` refuses the View.
 */

type Spec = Pick<ViewSpec, "encoding" | "claims">;
type Rules = Pick<
  RuleSettings,
  "pieMaxSlices" | "barsStartAtZero" | "maxSeries" | "minCvdDeltaE" | "maxRows"
>;

const distinct = (result: QueryResult, field: string) => {
  const at = columnIndex(result, field);
  if (at < 0) return 0;
  return new Set(result.rows.map((row) => row[at])).size;
};

/** Every field the spec reads must be a column of the result. */
export function checkFields(spec: Spec, result: QueryResult): CheckFinding[] {
  const missing = fieldsOf(spec).filter(
    (field) => columnIndex(result, field) < 0,
  );
  if (missing.length === 0) return [];
  return [
    {
      rule: "view.fields",
      outcome: "block",
      message: `The View reads ${missing.map((field) => `"${field}"`).join(", ")}, but the Query returns ${result.columns.map((column) => column.name).join(", ") || "no columns"}.`,
    },
  ];
}

export function checkShape(spec: Spec, result: QueryResult): CheckFinding[] {
  const findings: CheckFinding[] = [];
  if (result.rows.length === 0)
    findings.push({
      rule: "view.shape",
      outcome: "block",
      message: "The Query returned no rows, so there is nothing to draw.",
    });
  const encoding = spec.encoding;
  if (
    (encoding.kind === "line" || encoding.kind === "area") &&
    encoding.x.type === "category"
  )
    findings.push({
      rule: "view.shape",
      outcome: "block",
      message:
        "A line joins points in order. For names on x, use bars; for dates, set x.type to time.",
    });
  return findings;
}

export function checkPie(
  spec: Spec,
  result: QueryResult,
  rules: Rules,
): CheckFinding[] {
  if (spec.encoding.kind !== "pie" || rules.pieMaxSlices === null) return [];
  const slices = result.rows.length;
  return slices > rules.pieMaxSlices
    ? [
        {
          rule: "chart.pie_max_slices",
          outcome: "block",
          message: `This pie has ${slices} slices; the Rule allows ${rules.pieMaxSlices}. Use a bar chart.`,
        },
      ]
    : [];
}

export function checkBarBaseline(spec: Spec, rules: Rules): CheckFinding[] {
  if (spec.encoding.kind !== "bar" || !rules.barsStartAtZero) return [];
  return spec.encoding.y.zero === false
    ? [
        {
          rule: "chart.bars_start_at_zero",
          outcome: "block",
          message:
            "This bar chart's value axis does not start at zero. Remove y.zero, or use a line.",
        },
      ]
    : [];
}

export function checkSeries(
  spec: Spec,
  result: QueryResult,
  rules: Rules,
): CheckFinding[] {
  const encoding = spec.encoding;
  if (rules.maxSeries === null || !("series" in encoding) || !encoding.series)
    return [];
  const count = distinct(result, encoding.series.field);
  return count > rules.maxSeries
    ? [
        {
          rule: "chart.max_series",
          outcome: "block",
          message: `This chart has ${count} series; the Rule allows ${rules.maxSeries}. Keep the largest and fold the rest into "Other", or use a table.`,
        },
      ]
    : [];
}

export function checkColours(spec: Spec, rules: Rules): CheckFinding[] {
  if (rules.minCvdDeltaE === null) return [];
  const encoding = spec.encoding;
  const colors =
    "colors" in encoding && encoding.colors?.length ? encoding.colors : null;
  // The default palette is measured too, so the Rule's number means something.
  const palette = colors ?? [...PALETTE.light];
  const worst = worstAdjacentPair(palette);
  if (!worst || worst.deltaE >= rules.minCvdDeltaE) return [];
  return [
    {
      rule: "chart.colour_blind_safe",
      outcome: "block",
      message: colors
        ? `${worst.a} and ${worst.b} differ by ${worst.deltaE.toFixed(1)} for a colour-blind reader; the Rule asks for ${rules.minCvdDeltaE}. Leave colors out to use the default palette.`
        : `The default palette's closest pair differs by ${worst.deltaE.toFixed(1)}; the Rule asks for ${rules.minCvdDeltaE}. Lower the Rule or it blocks every chart.`,
    },
  ];
}

export function checkRowCap(result: QueryResult, rules: Rules): CheckFinding[] {
  return result.truncated
    ? [
        {
          rule: "query.max_rows",
          outcome: "flag",
          message: `The Query produced ${result.rowCount} rows; the View shows the first ${rules.maxRows}. Aggregate in the Query.`,
        },
      ]
    : [];
}

/** Every chart check, in the order a person would fix them. */
export function checkView(
  spec: Spec,
  result: QueryResult,
  rules: Rules,
): CheckFinding[] {
  const fields = checkFields(spec, result);
  // Without its fields the other checks would only repeat the same problem.
  if (fields.length > 0) return fields;
  return [
    ...checkShape(spec, result),
    ...checkPie(spec, result, rules),
    ...checkBarBaseline(spec, rules),
    ...checkSeries(spec, result, rules),
    ...checkColours(spec, rules),
    ...checkRowCap(result, rules),
  ];
}

export const blocks = (findings: CheckFinding[]) =>
  findings.some((finding) => finding.outcome === "block");
