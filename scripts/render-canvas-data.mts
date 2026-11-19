/**
 * Writes `fixtures/canvas/catalog.json` (DATA_VERSION, every Meridia table's
 * columns, exact row count and the sha256 of its CSV) and the two "bring your
 * own data" samples under `public/canvas/samples/`. Deterministic: re-running
 * changes nothing.
 *
 *   node --experimental-strip-types scripts/render-canvas-data.mts
 *   node --experimental-strip-types scripts/render-canvas-data.mts --out /tmp/meridia
 *
 * With `--out <dir>` it also writes every table's full CSV to <dir>/<table>.csv.
 * The full data (about a million rows) is never committed.
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { join, resolve } from "node:path";

type Resolve = (
  specifier: string,
  context: unknown,
  next: (specifier: string, context: unknown) => unknown,
) => unknown;
// Not yet in the installed @types/node.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve: Resolve }): void;
};

// The domain modules import each other without extensions, the way the app
// bundler expects; let Node find the .ts file.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const DATA_MODULE = "../src/features/canvas/domain/data/index.ts";
const SAMPLES_MODULE = "../src/features/canvas/domain/data/samples.ts";
const { CATALOG, DATA_VERSION, STORY_EVENTS, tableCsvChunks } = (await import(
  DATA_MODULE
)) as typeof import("../src/features/canvas/domain/data");
const { bikeShareTripsCsv, marketStallSalesCsv } = (await import(
  SAMPLES_MODULE
)) as typeof import("../src/features/canvas/domain/data/samples");

const ROOT = join(import.meta.dirname, "..");
const CATALOG_FILE = join(ROOT, "fixtures/canvas/catalog.json");
const SAMPLES_DIR = join(ROOT, "public/canvas/samples");

const outFlag = process.argv.indexOf("--out");
const outDir = outFlag >= 0 ? resolve(process.argv[outFlag + 1] ?? "") : null;
if (outFlag >= 0 && !process.argv[outFlag + 1]) {
  console.error("--out needs a directory");
  process.exit(1);
}
if (outDir) await mkdir(outDir, { recursive: true });

const started = performance.now();
const tables = [];
for (const table of CATALOG) {
  const hash = createHash("sha256");
  let bytes = 0;
  const file = outDir
    ? createWriteStream(join(outDir, `${table.name}.csv`))
    : null;
  for (const chunk of tableCsvChunks(table.name, 20_000)) {
    hash.update(chunk);
    bytes += Buffer.byteLength(chunk);
    if (file && !file.write(chunk)) await once(file, "drain");
  }
  if (file) {
    file.end();
    await once(file, "finish");
  }
  tables.push({
    name: table.name,
    title: table.title,
    group: table.group,
    grain: table.grain,
    rows: table.rows,
    bytes,
    sha256: hash.digest("hex"),
    columns: table.columns,
  });
}
const seconds = (performance.now() - started) / 1000;

const catalog = {
  dataVersion: DATA_VERSION,
  note: "The open data of the fictional Republic of Meridia, 2025: synthetic, SPECIMEN. Generated from a seed by src/features/canvas/domain/data. Written by scripts/render-canvas-data.mts; do not edit by hand.",
  totalRows: tables.reduce((sum, t) => sum + t.rows, 0),
  story: STORY_EVENTS.map((e) => ({
    id: e.id,
    title: e.title,
    tables: e.tables,
  })),
  tables,
};
await mkdir(join(ROOT, "fixtures/canvas"), { recursive: true });
await writeFile(CATALOG_FILE, `${JSON.stringify(catalog, null, 2)}\n`);

await mkdir(SAMPLES_DIR, { recursive: true });
const samples = {
  "market-stall-sales.csv": marketStallSalesCsv(),
  "bike-share-trips.csv": bikeShareTripsCsv(),
};
for (const [name, text] of Object.entries(samples)) {
  await writeFile(join(SAMPLES_DIR, name), text);
}

console.log(
  `Meridia ${DATA_VERSION}: ${tables.length} tables, ${catalog.totalRows.toLocaleString("en")} rows, generated and hashed in ${seconds.toFixed(1)} s.`,
);
for (const [name, text] of Object.entries(samples)) {
  console.log(
    `  public/canvas/samples/${name}: ${text.split("\n").length - 2} rows`,
  );
}
if (outDir) console.log(`  full CSVs written to ${outDir}`);
