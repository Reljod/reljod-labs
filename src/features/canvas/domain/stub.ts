import { VIEW_GRAMMAR, type ViewSpec } from "./view";

/**
 * The e2e suite's Analyst: a scripted tool sequence in place of the model.
 * The tools are real (the same MCP server, the Guard, the Sandbox, the
 * checks), so a stubbed turn proves everything but the model's judgement and
 * spends nothing on one.
 */
export const CHAT_STUB_HEADER = "x-canvas-stub";

export type StubCall = { name: string; args: Record<string, unknown> };

/** A line View with a slider and a date range: daily peak load of one region. */
export const STUB_SPEC: ViewSpec = {
  grammar: VIEW_GRAMMAR,
  title: "Daily peak load in Kestrel Coast",
  subtitle: "Grid load, megawatts, days at or above the threshold",
  finding:
    "Daily peak load in Kestrel Coast over February 2025. The slider keeps only days whose peak reached the threshold.",
  claims: [],
  query: {
    kind: "sql",
    sql: `select date_trunc('day', ts)::date as day, round(max(load_mw), 1) as peak_mw
from grid_load
where region_code = 'KES' and ts >= $from and ts < $to
group by all
having max(load_mw) >= $min_peak
order by day`,
  },
  params: [
    { name: "from", type: "date", value: "2025-02-01" },
    { name: "to", type: "date", value: "2025-03-01" },
    { name: "min_peak", type: "number", value: 0 },
  ],
  controls: [
    {
      kind: "slider",
      param: "min_peak",
      label: "Peak at least",
      min: 0,
      max: 3000,
      step: 50,
      unit: "MW",
    },
    {
      kind: "date_range",
      from: "from",
      to: "to",
      label: "Days",
      min: "2025-01-01",
      max: "2025-12-31",
    },
  ],
  encoding: {
    kind: "line",
    x: { field: "day", type: "time", label: "Day" },
    y: { field: "peak_mw", label: "Peak load", unit: "MW" },
  },
  annotations: [
    { kind: "band", from: "2025-02-10", to: "2025-02-16", label: "Heatwave" },
  ],
};

/** The tool calls a stubbed turn makes, in order. */
export function stubPlan(question: string): StubCall[] {
  if (/restricted|income per household|row by row/i.test(question))
    return [
      {
        name: "run_query",
        args: {
          sql: "select household_id, monthly_income_mdc from household_survey limit 5",
          purpose: "Row-level income (should be refused)",
        },
      },
    ];
  return [
    { name: "list_tables", args: {} },
    {
      name: "run_query",
      args: {
        sql: "select region_code, round(max(load_mw), 1) as peak_mw from grid_load group by all order by peak_mw desc",
        purpose: "Peak load by region",
      },
    },
    { name: "create_view", args: { spec: STUB_SPEC } },
  ];
}

export const STUB_REPLY =
  "Here is the daily peak load for Kestrel Coast in February. Move the slider to keep only the days above a threshold; the Query runs again in the Sandbox each time.";
