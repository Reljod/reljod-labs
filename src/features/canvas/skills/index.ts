/**
 * The Analyst's Skills (GLOSSARY): `SKILL.md` text it loads when a task
 * calls for one. A Skill is advice, never a check: only code makes a Check
 * finding or marks a View Verified.
 */
export type Skill = {
  id: string;
  name: string;
  /** One line, shown in the Analyst's instructions so it knows when to load it. */
  description: string;
  /** The SKILL.md body. */
  body: string;
};

const md = (skill: Omit<Skill, "body"> & { body: string }): Skill => ({
  ...skill,
  body: `---\nname: ${skill.id}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n\n${skill.body.trim()}\n`,
});

export const SKILLS: readonly Skill[] = [
  md({
    id: "choosing-a-chart",
    name: "Choosing a chart",
    description:
      "Pick the View kind and encoding for a question. Load before your first create_view.",
    body: `
Start from the comparison the person wants, not from the data you have.

| The question is about | Use | Notes |
| --- | --- | --- |
| Change over time | \`line\` | One row per (time, series). At most 8 series; fewer is better. Aggregate hourly data to days or weeks unless the hours are the point. |
| Parts of a whole over time | \`area\` | Stacked. Only when the total matters too. |
| Comparing categories | \`bar\` | Sort by value. \`horizontal: true\` when names are long or there are more than 8. Bars start at zero (a Rule enforces it). |
| A share of one total | \`pie\` | Five slices at most (a Rule). Fold the rest into "Other" in SQL. If in doubt, use a bar. |
| Two measures against each other | \`scatter\` | One row per thing. Add \`label\` for a few dozen points, not thousands. |
| Two dimensions and one measure | \`heatmap\` | Hour by weekday, month by region. Both axes need few distinct values (under 40). |
| Where, by region | \`map\` | A column of Meridia region codes (KES, ARV, ...) and one value per region. Normalise (per capita, percent) so big regions do not win by size. |
| One to six headline numbers | \`stat\` | One row. Give each tile a delta when there is a baseline. |
| Looking things up, or many measures | \`table\` | Up to 12 columns. Use \`bar: true\` on the one column worth scanning. |

Rules of thumb:

- One View, one idea. Two ideas are two Views; link them with a shared Parameter.
- Put the finding in the title ("The heatwave lifted northern peak load by a quarter"), the scope in the subtitle.
- Return only the columns the View uses. Round in SQL (\`round(x, 1)\`), not in the Finding.
- A Control should change something worth changing: a region, a date range, a threshold. Bind it to a Parameter the SQL uses as \`$name\`.
- Give Linked Views the same Parameter names and types; a change in one re-runs the others.
- An Annotation marks the thing the Finding talks about: a band over the heatwave week, a point on the peak.
- Leave \`colors\` out. The default palette is colour-blind safe; your own must pass a Rule.
`,
  }),
  md({
    id: "time-series-decomposition",
    name: "Time-series decomposition",
    description:
      "Separate trend, daily and weekly cycles, and what is left over, before calling something unusual.",
    body: `
Hourly and daily series in the Catalog (load, generation, weather, air quality, ridership, card spend) carry strong cycles. A raw peak is usually just a Tuesday at 18:00 in winter. Take the cycles out first.

1. **Pick the grain.** Hourly for within-day questions, daily for weeks and months. Aggregate in SQL: \`date_trunc('day', ts)\`.
2. **Baseline by position in the cycle.** For daily data, the median for the same weekday over the surrounding weeks:
   \`\`\`sql
   select day, value,
          median(value) over (partition by dayofweek(day)
                              order by day
                              rows between 4 preceding and 4 following) as expected
   from daily
   \`\`\`
   For hourly data, partition by \`(dayofweek(ts), hour(ts))\`.
3. **Trend.** A centred moving average longer than the longest cycle: 7 days for daily data, 28 to see through months.
4. **Remainder.** \`value - expected\`, and \`value / expected - 1\` as a percentage. This is what you report as unusual.
5. **Holidays.** A public holiday behaves like a Sunday. Do not report it as an anomaly; say so if it explains a dip.

In code (\`run_code\`), an STL-style split is a few lines of numpy over an input: moving average for trend, mean by cycle position for the seasonal part, the rest is the remainder. Use code when the window logic is awkward in SQL; otherwise SQL is faster and the Query is easier to read under Show the work.

When you show it: a \`line\` View of actual against expected, with a band Annotation over the unusual stretch, says more than three stacked panels.
`,
  }),
  md({
    id: "finding-anomalies",
    name: "Finding anomalies",
    description:
      "Find the days, places or lines that do not fit, and check each is real before reporting it.",
    body: `
An anomaly is a value that the ordinary pattern does not explain. Find candidates with code, then explain each with a second Query before it goes in a Finding.

**Find**

- Use a robust score, not mean and standard deviation (one spike inflates both):
  \`(value - median) / (1.4826 * mad)\` within a group. In DuckDB: \`median(x)\` and \`mad(x)\` as window functions partitioned by the cycle position (weekday, hour) and the entity (region, route, branch).
- Score the remainder after taking out the cycle (see the time-series Skill), not the raw value.
- Rank by score and look at the top 10 to 20. Anomalies cluster: several days in a row in the same places is one event, not seven.

**Check**

- Zeroes: a run of exact zeroes is a closure or a cancellation, not a low reading. Look for a flag column (\`cancelled\`).
- Totals that should reconcile: compare a reported total with the sum of its lines, per entity and period. A difference that is exactly zero almost everywhere and a few percent in one place is a finding.
- A second source: if load jumps, did temperature? If ferry boardings vanish, did rail beside it rise? Agreement between two Tables is the strongest evidence you can give.
- Scope: which regions, routes or categories, and which are untouched. The untouched ones are your control group.

**Report**

- Say what, where, when, how big against what baseline, and what else moved with it.
- Put the size in a Claim so code checks it. State the baseline in the Finding ("against the same weekdays in the four weeks before").
- Do not say why unless the data shows it. "Coincides with" is honest; "caused by" needs more than a chart.
`,
  }),
  md({
    id: "writing-fast-duckdb",
    name: "Writing fast DuckDB",
    description:
      "DuckDB idioms that keep a Query inside its time and row limits. Load before a heavy Query.",
    body: `
A Query has a time limit and returns a capped number of rows (both are Rules). The Tables are columnar and small enough that almost any aggregate is fast; what is slow is returning rows.

- **Aggregate in SQL, not in the View.** A chart needs tens to hundreds of rows. \`group by\` to the grain you will draw.
- **Select only what you use.** No \`select *\` into a View.
- **Filter early** with Parameters: \`where ts >= $from and ts < $to\`. Dates arrive typed; compare a timestamp column to a date directly.
- **Time buckets:** \`date_trunc('day', ts)\`, \`time_bucket(interval '6 hours', ts)\`, \`dayofweek(ts)\` (0 is Sunday), \`hour(ts)\`, \`strftime(ts, '%Y-%m')\`.
- **Window functions** beat self-joins: \`lag(x) over (partition by region_code order by day)\`, \`avg(x) over (... rows between 6 preceding and current row)\`.
- **\`qualify\`** filters on a window without a subquery: \`qualify row_number() over (partition by region_code order by load_mw desc) = 1\`.
- **Top N per group:** \`arg_max(ts, load_mw)\` gives the time of the peak; \`max_by\`, \`min_by\` likewise.
- **Pivots:** keep data long (one row per x and series) for charts; the grammar wants long. Use \`pivot\` only for a table View.
- **\`group by all\`** and \`order by all\` save typing and mistakes.
- **Approximate when exact does not matter:** \`approx_quantile(x, 0.5)\`, \`approx_count_distinct(id)\`.
- **Shares:** \`sum(x) / sum(sum(x)) over ()\`.
- **Joins:** join the small reference Table (regions, routes, branches) onto the aggregate, not onto the raw rows.

What the Guard allows: one SELECT (CTEs are fine) over Catalog Tables. No files, no \`read_csv\`, no \`attach\`, no DDL. A Restricted column may only appear inside an aggregate (\`avg\`, \`median\`, \`count\`, \`sum\`, quantiles), and each group must reach the minimum group size; smaller groups are dropped from the result, so say so if groups go missing.

For code: \`canvas.inputs\` are Parquet files from guarded SELECTs. Do the heavy lifting in the input SQL; let Python do only what SQL cannot.
`,
  }),
  md({
    id: "explaining-a-variance",
    name: "Explaining a variance",
    description:
      "Break a difference between two numbers (actual and budget, this period and last) into the parts that made it.",
    body: `
"Why is it different?" has an arithmetic answer before it has a story. Decompose first.

1. **State the two numbers and the gap.** Actual against budget, this year against last, this region against the rest. Absolute and percent.
2. **Break the gap down by one dimension at a time** (category, line item, municipality, month). For each member: its difference and its share of the total gap.
   \`\`\`sql
   select category,
          sum(actual_mdc) - sum(budgeted_mdc) as variance,
          (sum(actual_mdc) - sum(budgeted_mdc))
            / sum(sum(actual_mdc) - sum(budgeted_mdc)) over () as share_of_gap
   from municipal_budget_lines
   where fiscal_year = $year
   group by all order by abs(variance) desc
   \`\`\`
3. **Find the few members that carry it.** Usually two or three explain most of the gap; the rest net out. Report those, and the size of "everything else".
4. **Rate or volume?** When the number is price times quantity (spend = transactions x average ticket; boardings = services x load), split the gap: volume effect = change in quantity x old rate; rate effect = change in rate x new quantity. They add up to the gap exactly.
5. **Check that it adds up.** The parts must sum to the gap. If a reported total differs from the sum of its lines, that difference is itself a finding: say where and how much, and do not paper over it.

Show it as a horizontal \`bar\` of variance by member, sorted, with the total in the title; or a \`table\` with budget, actual, variance and share, with \`bar: true\` on variance. Put the gap and the top contributor in Claims.

Language: "X accounts for 61% of the overrun" is arithmetic and can be Verified. "X overspent because of the storm" is a hypothesis: say what in the data supports it (timing, place) and keep it apart from the numbers.
`,
  }),
];

export function skillOf(id: string): Skill | undefined {
  const wanted = id.trim().toLowerCase();
  return SKILLS.find(
    (skill) => skill.id === wanted || skill.name.toLowerCase() === wanted,
  );
}
