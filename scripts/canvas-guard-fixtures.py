"""Writes src/features/canvas/domain/guard.fixtures.extra.json: the parse trees
DuckDB gives for SQL shapes found in review that the Guard must judge. Run it
with a Python that has duckdb (the same version as the Sandbox image):

    python scripts/canvas-guard-fixtures.py

The Guard's unit tests read the file; add a case here, run this, add the test.
"""
import json
import os

import duckdb

CASES = {
    # Must be refused: each returns a household's own value.
    "correlated_scalar": "select (select h.monthly_income_mdc), (select h.household_id) from household_survey h",
    "lateral_leak": "select x from household_survey h, lateral (select h.monthly_income_mdc as x)",
    "lateral_whole_row": "select s from household_survey h, lateral (select h as s)",
    "nested_whole_row": "select (select h) from household_survey h",
    "cte_shadow": "select monthly_income_mdc from household_survey, (with household_survey as (select 1 x) select x from household_survey) s",
    "join_multiplies": "select h.household_id, avg(h.monthly_income_mdc) from household_survey h, range(10) r group by h.household_id",
    "self_join_multiplies": "select a.household_id, avg(a.monthly_income_mdc) from household_survey a join household_survey b on true group by 1",
    "arbitrary_fn": "select region_code, arbitrary(household_id), arbitrary(monthly_income_mdc) from household_survey group by region_code",
    "quantile_disc_max": "select region_code, quantile_disc(monthly_income_mdc, 1) from household_survey group by region_code",
    "approx_top_k_fn": "select region_code, approx_top_k(monthly_income_mdc, 3) from household_survey group by region_code",
    "arg_max_null_fn": "select region_code, arg_max_null(monthly_income_mdc, respondent_age) from household_survey group by region_code",
    "unknown_scalar": "select region_code, sha256(household_id::varchar) from household_survey group by all",
    # Must pass, with the minimum group size added.
    "rounded_avg": "select region_code, round(avg(monthly_income_mdc)) as mean_income from household_survey group by all order by 1",
    "avg_of_case": "select region_code, avg(case when monthly_income_mdc > 4000 then 1 else 0 end) as share from household_survey group by 1",
    "banded_group": "select floor(respondent_age / 10) * 10 as age_band, count(*) as n, median(monthly_income_mdc) as m from household_survey group by 1",
    "aggregate_then_join": "with s as (select region_code, avg(monthly_income_mdc) as income from household_survey group by 1) select g.region_code, s.income, max(g.load_mw) as peak from grid_load g join s using (region_code) group by 1, 2",
    "nested_own_table": "select region_code, count(*) as n from household_survey where region_code in (select region_code from household_survey group by 1 having avg(monthly_income_mdc) > 3000) group by 1",
    # Must pass untouched: a join that touches no Restricted column.
    "open_join": "select h.region_code, count(*) as n, max(g.load_mw) as peak from household_survey h join grid_load g using (region_code) group by 1",
}

con = duckdb.connect()
out = {"duckdb": duckdb.__version__, "cases": {}}
for name, sql in CASES.items():
    out["cases"][name] = {
        "sql": sql,
        "ast": json.loads(con.execute("select json_serialize_sql(?)", [sql]).fetchone()[0]),
    }
path = os.path.join(os.path.dirname(__file__), "..", "src", "features", "canvas", "domain", "guard.fixtures.extra.json")
with open(path, "w") as handle:
    json.dump(out, handle, indent=1)
    handle.write("\n")
print("wrote", len(CASES), "cases with DuckDB", duckdb.__version__)
