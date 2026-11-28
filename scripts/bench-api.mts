/**
 * Latency and database load of the demos' pages and REST routes.
 *
 *   DB_STATS=1 pnpm build && DB_STATS=1 pnpm start --port 3200
 *   node --env-file-if-exists=.env.local scripts/bench-api.mts targets.json out.json
 *
 * `targets.json` is a list of `{ "name", "path", "method"?, "body"? }`. Each
 * target is sent `BENCH_N` times (default 20, after 2 warm-ups), one request
 * at a time, as the e2e suite (`x-e2e-token`, stubbed models). Around each
 * request the server's statement count (`GET /api/bench/db-stats`, only
 * served with `DB_STATS=1`) is read, so the difference is every SQL
 * statement that request ran, the proxy's included. Writes go to the `e2e`
 * Owner's rows only. Prints a table and writes the raw numbers to `out.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";

type Target = { name: string; path: string; method?: string; body?: unknown };

const base = process.env.BENCH_BASE_URL ?? "http://localhost:3200";
const runs = Number(process.env.BENCH_N ?? 20);
const token = process.env.E2E_BYPASS_TOKEN ?? "";
const [targetsFile, outFile] = process.argv.slice(2);
if (!targetsFile || !token) {
  console.error(
    "usage: node --env-file-if-exists=.env.local scripts/bench-api.mts targets.json [out.json] (needs E2E_BYPASS_TOKEN)",
  );
  process.exit(2);
}
const targets = JSON.parse(readFileSync(targetsFile, "utf8")) as Target[];
const headers = { "x-e2e-token": token, accept: "*/*" };

async function statements(): Promise<number> {
  const response = await fetch(`${base}/api/bench/db-stats`, { headers });
  if (!response.ok)
    throw new Error(
      "Start the server with DB_STATS=1 (db-stats answered 404).",
    );
  return ((await response.json()) as { statements: number }).statements;
}

async function once(target: Target) {
  const before = await statements();
  const started = performance.now();
  const response = await fetch(`${base}${target.path}`, {
    method: target.method ?? "GET",
    headers:
      target.body === undefined
        ? headers
        : { ...headers, "content-type": "application/json" },
    body: target.body === undefined ? undefined : JSON.stringify(target.body),
    redirect: "manual",
  });
  const bytes = (await response.arrayBuffer()).byteLength;
  const ms = performance.now() - started;
  // Work `after()` the answer (sweeps, audit) lands a moment later.
  await new Promise((resolve) => setTimeout(resolve, 30));
  return {
    status: response.status,
    ms,
    bytes,
    queries: (await statements()) - before,
  };
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    ] ?? 0
  );
};

const results = [];
for (const target of targets) {
  for (let i = 0; i < 2; i++) await once(target);
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await once(target));
  const ms = samples.map((s) => s.ms);
  const queries = samples.map((s) => s.queries);
  const row = {
    name: target.name,
    status: samples[0]?.status,
    p50: Math.round(percentile(ms, 50)),
    p95: Math.round(percentile(ms, 95)),
    queries: percentile(queries, 50),
    maxQueries: Math.max(...queries),
    kb: Math.round((samples[0]?.bytes ?? 0) / 102.4) / 10,
  };
  results.push(row);
  console.log(
    [
      row.name.padEnd(44),
      String(row.status).padStart(4),
      `${row.p50}ms`.padStart(8),
      `${row.p95}ms`.padStart(8),
      `${row.queries}q`.padStart(5),
      `${row.kb}KB`.padStart(9),
    ].join(" "),
  );
}
if (outFile) writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
