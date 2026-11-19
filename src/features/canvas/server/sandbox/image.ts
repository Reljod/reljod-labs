import "server-only";
import { gzipSync } from "node:zlib";
import { Sandbox } from "@vercel/sandbox";
import {
  CATALOG,
  type ColumnType,
  DATA_VERSION,
  tableCsvChunks,
} from "../../domain/data";
import { sql } from "../db";
import { env } from "../env";
import { SandboxUnavailable } from "../errors";
import {
  CANVAS_LIB_PY,
  DATA_DB,
  INBOX_DIR,
  RUNNER_PATH,
  RUNNER_PY,
  RUNNER_VERSION,
} from "./runner-source";

/*
 * The Sandbox image (ADR 0032): one snapshot of a microVM that already holds
 * the Meridia Catalog as a DuckDB file, DuckDB itself, the runner and the
 * unprivileged user the Analyst's code runs as. It is built once per data
 * and runner version, with the network on, and every Owner's Sandbox starts
 * from it with the network off. It holds only the synthetic open data.
 */

/** The image this code needs. A new data or runner version is a new image. */
export const IMAGE_KEY = `${DATA_VERSION}:r${RUNNER_VERSION}`;

const REGION = "syd1";
const BUILD_MINUTES = 12;
/** A build claimed longer ago than this is taken to have died. */
const STALE_CLAIM_MINUTES = 15;
const LOAD_DIR = "/tmp/canvas-load";

const DUCK_TYPE: Record<ColumnType, string> = {
  integer: "BIGINT",
  double: "DOUBLE",
  varchar: "VARCHAR",
  date: "DATE",
  timestamp: "TIMESTAMP",
  boolean: "BOOLEAN",
};

/** The Python that loads every CSV into the DuckDB file, typed as the Catalog says. */
export function loadScript(
  dataDb: string = DATA_DB,
  loadDir: string = LOAD_DIR,
) {
  const tables = CATALOG.map((table) => ({
    name: table.name,
    columns: table.columns.map(
      (column) => `"${column.name}" ${DUCK_TYPE[column.type]}`,
    ),
    rows: table.rows,
  }));
  return `
import json, duckdb
tables = json.loads(${JSON.stringify(JSON.stringify(tables))})
con = duckdb.connect("${dataDb}")
for table in tables:
    con.execute('create table "' + table["name"] + '" (' + ", ".join(table["columns"]) + ")")
    con.execute('copy "' + table["name"] + '" from \\'${loadDir}/' + table["name"] + ".csv.gz' (format csv, header true, nullstr '')")
    rows = con.execute('select count(*) from "' + table["name"] + '"').fetchone()[0]
    if rows != table["rows"]:
        raise SystemExit(table["name"] + ": loaded " + str(rows) + " rows, the Catalog says " + str(table["rows"]))
con.execute("checkpoint")
con.close()
print("loaded", len(tables))
`;
}

async function sh(sandbox: Sandbox, script: string, timeoutMs = 240_000) {
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", script],
    sudo: true,
    timeoutMs,
  });
  if (result.exitCode !== 0) {
    const [out, err] = await Promise.all([result.stdout(), result.stderr()]);
    throw new Error(
      `image build step failed (${result.exitCode}): ${(err || out).slice(-600)}`,
    );
  }
}

/** Builds the image and returns its snapshot id. Takes a minute or two. */
async function build(): Promise<string> {
  const sandbox = await Sandbox.create({
    runtime: "python3.13",
    region: REGION,
    timeout: BUILD_MINUTES * 60_000,
    resources: { vcpus: 2 },
  } as Parameters<typeof Sandbox.create>[0]);
  try {
    await sh(
      sandbox,
      `set -e
mkdir -p /opt/canvas/lib /data /work ${INBOX_DIR} ${LOAD_DIR}
chmod 777 ${LOAD_DIR}
pip install --quiet --root-user-action=ignore duckdb numpy
id analyst >/dev/null 2>&1 || useradd --create-home analyst`,
    );
    // One gzipped CSV per Table, written one at a time to keep memory flat.
    for (const table of CATALOG) {
      const chunks: Buffer[] = [];
      for (const chunk of tableCsvChunks(table.name))
        chunks.push(Buffer.from(chunk, "utf8"));
      await sandbox.writeFiles([
        {
          path: `${LOAD_DIR}/${table.name}.csv.gz`,
          content: gzipSync(Buffer.concat(chunks), { level: 6 }),
        },
      ]);
    }
    await sandbox.writeFiles([
      { path: `${LOAD_DIR}/load.py`, content: Buffer.from(loadScript()) },
      { path: `${LOAD_DIR}/runner.py`, content: Buffer.from(RUNNER_PY) },
      { path: `${LOAD_DIR}/canvas.py`, content: Buffer.from(CANVAS_LIB_PY) },
    ]);
    await sh(
      sandbox,
      `set -e
python3 ${LOAD_DIR}/load.py
install -m 700 ${LOAD_DIR}/runner.py ${RUNNER_PATH}
install -m 644 ${LOAD_DIR}/canvas.py /opt/canvas/lib/canvas.py
rm -rf ${LOAD_DIR}
chown -R root:root /data /opt/canvas
chmod 700 /data
chmod 755 /opt/canvas /opt/canvas/lib
chmod 711 /work
chmod 1777 ${INBOX_DIR}
runuser -u analyst -- python3 -c "import duckdb, numpy"
! runuser -u analyst -- ls /data >/dev/null 2>&1`,
    );
    const snapshot = await sandbox.snapshot({ expiration: 0 });
    return snapshot.snapshotId;
  } finally {
    // Taking a snapshot stops the Sandbox; this only clears up a failed build.
    await sandbox.stop().catch(() => {});
  }
}

let ready: { key: string; snapshotId: string } | undefined;

/**
 * The snapshot every Owner's Sandbox starts from. Built on first use, by
 * whichever request gets there first; the others are told to come back.
 */
export async function ensureImage(): Promise<string> {
  if (ready?.key === IMAGE_KEY) return ready.snapshotId;
  if (!env.sandboxConfigured())
    throw new SandboxUnavailable("Sandbox unavailable: it is not set up here.");
  const db = sql();
  const [row] = await db<
    { snapshot_id: string | null; status: string; stale: boolean }[]
  >`
    select snapshot_id, status,
           claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}) as stale
    from canvas.sandbox_images where key = ${IMAGE_KEY}`;
  if (row?.status === "ready" && row.snapshot_id) {
    ready = { key: IMAGE_KEY, snapshotId: row.snapshot_id };
    return row.snapshot_id;
  }
  const [claim] = row
    ? row.stale
      ? await db<{ key: string }[]>`
          update canvas.sandbox_images set claimed_at = now()
          where key = ${IMAGE_KEY} and status = 'building'
            and claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})
          returning key`
      : []
    : await db<{ key: string }[]>`
        insert into canvas.sandbox_images (key, status) values (${IMAGE_KEY}, 'building')
        on conflict (key) do nothing
        returning key`;
  if (!claim)
    throw new SandboxUnavailable(
      "The Sandbox is loading the Meridia data for the first time. Try again in a minute or two.",
    );
  try {
    const snapshotId = await build();
    await db`
      update canvas.sandbox_images
      set snapshot_id = ${snapshotId}, status = 'ready', built_at = now()
      where key = ${IMAGE_KEY}`;
    ready = { key: IMAGE_KEY, snapshotId };
    return snapshotId;
  } catch (error) {
    await db`delete from canvas.sandbox_images where key = ${IMAGE_KEY} and status = 'building'`.catch(
      () => {},
    );
    console.error(
      "[canvas] image build failed",
      error instanceof Error ? error.message : error,
    );
    throw new SandboxUnavailable(
      "Sandbox unavailable: the Meridia data could not be loaded. Try again in a minute.",
    );
  }
}

/** Forget an image that turned out to be gone (its snapshot was deleted), so the next call rebuilds it. */
export async function forgetImage(snapshotId: string) {
  ready = undefined;
  await sql()`
    delete from canvas.sandbox_images
    where key = ${IMAGE_KEY} and snapshot_id = ${snapshotId}`;
}
