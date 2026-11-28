"""Records src/features/canvas/server/sandbox/stub.fixtures.json: the parse
trees DuckDB gives for the statements the stubbed e2e suite sends (the stub
Analyst's plan, STUB_SPEC and STUB_PROBES in domain/stub.ts). The stub
Sandbox answers `serialize` from this file, so the Guard judges real trees
with no Sandbox. Run it with the DuckDB of the Sandbox image:

    uv run --no-project --with duckdb==2.0.0 python scripts/canvas-stub-fixtures.py

To add a statement: add {"sql": ...} under `cases`, run this, and give it a
canned answer in server/sandbox/stub.ts if it must return rows.
"""
import json
import os

import duckdb

path = os.path.join(
    os.path.dirname(__file__), "..", "src", "features", "canvas", "server", "sandbox", "stub.fixtures.json"
)
with open(path) as handle:
    data = json.load(handle)

con = duckdb.connect()
data["duckdb"] = duckdb.__version__
for case in data["cases"].values():
    case["ast"] = json.loads(con.execute("select json_serialize_sql(?)", [case["sql"]]).fetchone()[0])

with open(path, "w") as handle:
    json.dump(data, handle, indent=1)
    handle.write("\n")
print("recorded", len(data["cases"]), "statements with DuckDB", duckdb.__version__)
