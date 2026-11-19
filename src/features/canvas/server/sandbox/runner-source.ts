/**
 * The two Python files Canvas puts in its Sandbox image (ADR 0031), kept here
 * as text so the image build can write them. Bump `RUNNER_VERSION` whenever
 * either changes: it is part of the image's key, so a new image is built.
 *
 * `runner.py` runs as root and is the only thing that touches the Catalog. It
 * executes SQL the Guard has already passed (as a parsed statement, turned
 * back into SQL by DuckDB itself), on a read-only connection with external
 * access switched off, and runs the Analyst's code as the unprivileged user
 * `analyst`, who cannot read `/data` and has no sudo.
 */
export const RUNNER_VERSION = "1";

export const RUNNER_PATH = "/opt/canvas/runner.py";
export const DATA_DB = "/data/meridia.duckdb";
export const UPLOADS_DB = "/data/uploads.duckdb";
export const INBOX_DIR = "/tmp/canvas-in";

export const RUNNER_PY = String.raw`
import base64, datetime, decimal, json, math, os, re, shutil, subprocess, sys, threading, time, uuid

import duckdb

DATA_DB = "/data/meridia.duckdb"
UPLOADS_DB = "/data/uploads.duckdb"
WORK = "/work"
NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
PARAM = re.compile(r"\$([a-z][a-z0-9_]*)")


def plain(value):
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, decimal.Decimal):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, datetime.datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, datetime.timedelta):
        return value.total_seconds()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return None
    return str(value)[:400]


def upload_tables():
    if not os.path.exists(UPLOADS_DB):
        return []
    con = duckdb.connect(UPLOADS_DB, read_only=True)
    try:
        return [row[0] for row in con.execute(
            "select table_name from information_schema.tables where table_schema = 'main' order by 1"
        ).fetchall()]
    finally:
        con.close()


def connect(lock=True):
    """The Catalog, read-only. Uploads appear as temporary views beside the Tables."""
    con = duckdb.connect(DATA_DB, read_only=True)
    con.execute("set threads = 2")
    con.execute("set memory_limit = '2500MB'")
    if os.path.exists(UPLOADS_DB):
        con.execute("attach '" + UPLOADS_DB + "' as uploads (read_only)")
        for (name,) in con.execute(
            "select table_name from information_schema.tables where table_catalog = 'uploads' and table_schema = 'main'"
        ).fetchall():
            if NAME.match(name):
                con.execute('create temp view "' + name + '" as select * from uploads.main."' + name + '"')
    if lock:
        con.execute("set enable_external_access = false")
        con.execute("set lock_configuration = true")
    return con


def bound(sql, params):
    """Only the Parameters the SQL names, typed: a date arrives as a date."""
    values = {}
    for name in set(PARAM.findall(sql)):
        if name not in params:
            raise ValueError('The Query uses $' + name + ', which was given no value.')
        value = params[name]
        if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", value):
            value = datetime.date.fromisoformat(value)
        values[name] = value
    return values


def sql_of(con, statement):
    """The SQL to run: given as text, or as a parsed statement the Guard rewrote."""
    if statement.get("ast") is not None:
        return con.execute("select json_deserialize_sql(?::json)", [json.dumps(statement["ast"])]).fetchone()[0]
    return statement["sql"]


def with_deadline(con, seconds):
    timer = threading.Timer(seconds, con.interrupt)
    timer.daemon = True
    timer.start()
    return timer


def missing_uploads(job):
    have = set(upload_tables())
    return [name for name in job.get("uploads", []) if name not in have]


def op_serialize(job):
    con = duckdb.connect()
    out = []
    for sql in job["sqls"]:
        try:
            text = con.execute("select json_serialize_sql(?)", [sql]).fetchone()[0]
            out.append(json.loads(text))
        except Exception as error:  # noqa: BLE001
            out.append({"error": True, "error_message": str(error)[:600]})
    return {"asts": out}


def run_select(con, sql, params, max_rows, seconds):
    started = time.time()
    timer = with_deadline(con, seconds)
    try:
        cursor = con.execute(sql, bound(sql, params))
        columns = [{"name": item[0], "type": str(item[1]).lower()} for item in cursor.description]
        rows = cursor.fetchmany(max_rows + 1)
        truncated = len(rows) > max_rows
        rows = rows[:max_rows]
        count = len(rows)
        if truncated:
            count = con.execute("select count(*) from (" + sql + ") as canvas_counted", bound(sql, params)).fetchone()[0]
    finally:
        timer.cancel()
    return {
        "columns": columns,
        "rows": [[plain(cell) for cell in row] for row in rows],
        "rowCount": count,
        "truncated": truncated,
        "ms": int((time.time() - started) * 1000),
    }


def op_query(job):
    missing = missing_uploads(job)
    if missing:
        return {"missing": missing}
    con = connect()
    try:
        sql = sql_of(con, job)
        result = run_select(con, sql, job.get("params", {}), int(job["maxRows"]), float(job["seconds"]))
        result["sql"] = sql
        return result
    finally:
        con.close()


def capped(path, limit):
    try:
        size = os.path.getsize(path)
        with open(path, "r", errors="replace") as handle:
            text = handle.read(limit)
        return text + ("\n… [" + str(size - limit) + " more bytes cut]" if size > limit else "")
    except OSError:
        return ""


def op_code(job):
    missing = missing_uploads(job)
    if missing:
        return {"missing": missing}
    started = time.time()
    seconds = float(job["seconds"])
    work = os.path.join(WORK, uuid.uuid4().hex)
    os.makedirs(work, exist_ok=True)
    inputs = []
    try:
        # Inputs are guarded SELECTs, written out as Parquet for the code to read.
        con = connect(lock=False)
        try:
            for item in job.get("inputs", []):
                name = item["name"]
                if not NAME.match(name):
                    raise ValueError("Bad input name.")
                sql = sql_of(con, item)
                path = os.path.join(work, name + ".parquet")
                timer = with_deadline(con, seconds)
                try:
                    con.execute(
                        "copy (select * from (" + sql + ") as canvas_input limit " + str(int(job["maxInputRows"])) + ") to '" + path + "' (format parquet)",
                        bound(sql, job.get("params", {})),
                    )
                finally:
                    timer.cancel()
                rows = con.execute("select count(*) from read_parquet('" + path + "')").fetchone()[0]
                inputs.append({"name": name, "rows": rows, "sql": sql})
        finally:
            con.close()
        with open(os.path.join(work, "job.json"), "w") as handle:
            json.dump({"params": job.get("params", {}), "inputs": [item["name"] for item in inputs]}, handle)
        with open(os.path.join(work, "main.py"), "w") as handle:
            handle.write(job["code"])
        subprocess.run(["chown", "-R", "analyst:analyst", work], check=True)
        left = max(2, int(seconds - (time.time() - started)))
        out, err = os.path.join(work, "stdout.txt"), os.path.join(work, "stderr.txt")
        shell = (
            "ulimit -f 40000 2>/dev/null; cd " + work + " && "
            "timeout -k 2 " + str(left) + " env PYTHONPATH=/opt/canvas/lib HOME=" + work + " python3 main.py >stdout.txt 2>stderr.txt"
        )
        done = subprocess.run(["runuser", "-u", "analyst", "--", "sh", "-c", shell])
        code = done.returncode
        limit = int(job["outputChars"])
        stdout, stderr = capped(out, limit), capped(err, limit)
        if code == 124:
            stderr += "\nTimed out after " + str(left) + " s."
        table = None
        result_path = os.path.join(work, "result.json")
        if code == 0 and os.path.exists(result_path) and os.path.getsize(result_path) < 30_000_000:
            with open(result_path) as handle:
                raw = json.load(handle)
            columns = [{"name": str(item["name"])[:64], "type": str(item.get("type", "varchar"))[:24]} for item in raw["columns"]][:60]
            max_rows = int(job["maxRows"])
            all_rows = raw["rows"]
            table = {
                "columns": columns,
                "rows": [[plain(cell) for cell in row[: len(columns)]] for row in all_rows[:max_rows]],
                "rowCount": len(all_rows),
                "truncated": len(all_rows) > max_rows,
            }
        return {
            "stdout": stdout,
            "stderr": stderr,
            "exitCode": code,
            "inputs": inputs,
            "table": table,
            "ms": int((time.time() - started) * 1000),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def op_import(job):
    table, path, kind = job["table"], job["path"], job["format"]
    if not NAME.match(table):
        raise ValueError("Bad table name.")
    if not path.startswith("/tmp/canvas-in/") or ".." in path or "'" in path:
        raise ValueError("Bad path.")
    reader = "read_parquet('" + path + "')" if kind == "parquet" else "read_csv('" + path + "', sample_size = 50000)"
    con = duckdb.connect(UPLOADS_DB)
    try:
        con.execute("set threads = 2")
        timer = with_deadline(con, float(job["seconds"]))
        try:
            con.execute('create or replace table "' + table + '" as select * from ' + reader)
        finally:
            timer.cancel()
        described = con.execute('describe "' + table + '"').fetchall()
        if len(described) > int(job["maxColumns"]):
            con.execute('drop table "' + table + '"')
            raise ValueError("The file has " + str(len(described)) + " columns; the most an Upload may have is " + str(job["maxColumns"]) + ".")
        rows = con.execute('select count(*) from "' + table + '"').fetchone()[0]
        summary = {row[0]: row for row in con.execute('summarize "' + table + '"').fetchall()}
        columns = []
        for name, kind_name, *_rest in described:
            stats = summary.get(name)
            columns.append({
                "name": name,
                "type": str(kind_name).lower(),
                "min": plain(stats[2]) if stats else None,
                "max": plain(stats[3]) if stats else None,
                "distinct": plain(stats[4]) if stats else None,
                "nullPct": plain(stats[11]) if stats else None,
            })
        sample = con.execute('select * from "' + table + '" limit 5').fetchall()
        return {"table": table, "rows": rows, "columns": columns, "sample": [[plain(cell) for cell in row] for row in sample]}
    finally:
        con.close()
        try:
            os.remove(path)
        except OSError:
            pass


def op_drop(job):
    table = job["table"]
    if not NAME.match(table):
        raise ValueError("Bad table name.")
    if os.path.exists(UPLOADS_DB):
        con = duckdb.connect(UPLOADS_DB)
        try:
            con.execute('drop table if exists "' + table + '"')
        finally:
            con.close()
    return {"dropped": table}


OPS = {"serialize": op_serialize, "query": op_query, "code": op_code, "import": op_import, "drop": op_drop,
       "uploads": lambda job: {"tables": upload_tables()}}


def main():
    arg = sys.argv[1]
    if arg.startswith("@"):
        # A job too long for a command line arrives as a file in the inbox.
        path = arg[1:]
        if not path.startswith("/tmp/canvas-in/") or ".." in path:
            raise SystemExit("Bad job path.")
        with open(path) as handle:
            job = json.load(handle)
        os.remove(path)
    else:
        job = json.loads(base64.b64decode(arg))
    try:
        answer = OPS[job["op"]](job)
    except duckdb.InterruptException:
        answer = {"error": "Stopped: it ran past the time limit.", "kind": "timeout"}
    except duckdb.Error as error:
        answer = {"error": str(error)[:1200], "kind": "sql"}
    except Exception as error:  # noqa: BLE001
        answer = {"error": str(error)[:1200], "kind": "runner"}
    sys.stdout.write(json.dumps(answer, separators=(",", ":"), allow_nan=False))


main()
`;

/** What the Analyst's code imports as `canvas`. Runs as the unprivileged user. */
export const CANVAS_LIB_PY = String.raw`
"""Canvas helpers for code that runs in the Sandbox.

    import canvas
    canvas.params            # the View's Parameters, by name
    canvas.inputs            # {name: path to a Parquet file} for each input
    canvas.sql("select ...") # DuckDB over the inputs, each a view named after itself
    canvas.rows("name")      # an input as a list of tuples
    canvas.table(columns, rows)  # the result: what the View draws
"""
import datetime, decimal, json, math, os

import duckdb

with open("job.json") as _handle:
    _job = json.load(_handle)

params = _job["params"]
inputs = {name: os.path.abspath(name + ".parquet") for name in _job["inputs"]}
_con = None


def con():
    global _con
    if _con is None:
        _con = duckdb.connect()
        for name, path in inputs.items():
            _con.execute('create view "' + name + '" as select * from read_parquet(\'' + path + '\')')
    return _con


def sql(query, parameters=None):
    return con().execute(query, parameters) if parameters is not None else con().execute(query)


def rows(name):
    return sql('select * from "' + name + '"').fetchall()


def columns(name):
    return [item[0] for item in sql('select * from "' + name + '" limit 0').description]


def _plain(value):
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, datetime.datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return str(value)


def _kind(values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, int):
            return "bigint"
        if isinstance(value, float):
            return "double"
        text = str(value)
        if len(text) == 19 and text[4] == "-" and text[13] == ":":
            return "timestamp"
        if len(text) == 10 and text[4] == "-" and text[7] == "-":
            return "date"
        return "varchar"
    return "varchar"


def table(column_names, data):
    """Sets the result. column_names: list of names; data: list of rows (lists or tuples)."""
    cleaned = [[_plain(cell) for cell in row] for row in data]
    described = [
        {"name": str(name), "type": _kind([row[index] for row in cleaned[:200] if index < len(row)])}
        for index, name in enumerate(column_names)
    ]
    with open("result.json", "w") as handle:
        json.dump({"columns": described, "rows": cleaned}, handle, allow_nan=False)
`;
