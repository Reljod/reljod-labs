import "server-only";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { CATALOG, tableCsvChunks } from "../../domain/data";
import { IMAGE_KEY, loadScript } from "./image";
import { RUNNER_PY } from "./runner-source";

/*
 * The local runner, for development and the e2e suite only (ADR 0032). When
 * `CANVAS_LOCAL_RUNNER` names a Python that has DuckDB, guarded Queries run
 * on this machine with the very same `runner.py`, on the same read-only
 * connection with external access switched off. It exists so the demo can
 * be developed and tested when Vercel Sandbox cannot be reached.
 *
 * It is not a sandbox, so it never runs the Analyst's code (`run_code` is
 * refused), and it cannot be switched on in production or on Vercel.
 */

const run = promisify(execFile);

/** The Python to run the runner with, or null when the local runner is off. */
export function localPython(): string | null {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return null;
  return process.env.CANVAS_LOCAL_RUNNER || null;
}

const home = () =>
  join(
    tmpdir(),
    `canvas-local-${createHash("sha256").update(IMAGE_KEY).digest("hex").slice(0, 12)}`,
  );

let built: Promise<string> | undefined;

/** Loads the Catalog into a DuckDB file on this machine, once per data version. */
function ensureData(python: string): Promise<string> {
  built ??= (async () => {
    const dir = home();
    const db = join(dir, "meridia.duckdb");
    const runner = join(dir, "runner.py");
    await mkdir(dir, { recursive: true });
    await writeFile(runner, RUNNER_PY);
    if (existsSync(db)) return dir;
    const load = join(dir, "load");
    const building = join(dir, "building.duckdb");
    await rm(load, { recursive: true, force: true });
    await rm(building, { force: true });
    await mkdir(load, { recursive: true });
    for (const table of CATALOG) {
      const chunks: Buffer[] = [];
      for (const chunk of tableCsvChunks(table.name))
        chunks.push(Buffer.from(chunk, "utf8"));
      await writeFile(
        join(load, `${table.name}.csv.gz`),
        gzipSync(Buffer.concat(chunks), { level: 1 }),
      );
    }
    await writeFile(join(load, "load.py"), loadScript(building, load));
    await run(python, [join(load, "load.py")], { timeout: 300_000 });
    // In place only when complete, so a half-loaded file is never queried.
    await rename(building, db);
    await rm(load, { recursive: true, force: true });
    return dir;
  })().catch((error) => {
    built = undefined;
    throw error;
  });
  return built;
}

/** Runs one runner job on this machine and returns its JSON answer. */
export async function runLocal(
  python: string,
  job: { op: string } & Record<string, unknown>,
  seconds: number,
): Promise<Record<string, unknown>> {
  if (job.op === "code")
    return {
      error:
        "Code needs the Sandbox, which this server is running without. Answer with SQL instead.",
      kind: "runner",
    };
  if (job.op !== "serialize" && job.op !== "query")
    return { error: "That needs the Sandbox.", kind: "runner" };
  const dir = await ensureData(python);
  const arg = Buffer.from(JSON.stringify(job), "utf8").toString("base64");
  const { stdout } = await run(python, [join(dir, "runner.py"), arg], {
    timeout: (seconds + 15) * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      CANVAS_DATA_DB: join(dir, "meridia.duckdb"),
      CANVAS_UPLOADS_DB: join(dir, "no-uploads.duckdb"),
    },
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}
