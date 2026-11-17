/**
 * Runs the Sieve Analyst over Corpus Documents in this process (no web
 * server, no database) and prints recall, precision, cost and time per
 * Document. It calls paid models and starts Vercel Sandboxes: run it by hand,
 * never in tests or CI.
 *
 *   node --env-file-if-exists=.env.local scripts/eval-name-extraction.mts            # the test split
 *   node --env-file-if-exists=.env.local scripts/eval-name-extraction.mts ne-va-01 ne-va-03
 *   ... --split=validation --analyst=anthropic/claude-sonnet-5.5 --reader=openai/gpt-6-luna --verbose
 *   ... ne-tr-11 --record   # also writes public/name-extraction/replays/ne-tr-11.json
 *
 * Needs NAME_EXTRACTION_AI_GATEWAY_API_KEY, and VERCEL_OIDC_TOKEN (from
 * `vercel env pull .env.local`) for run_code.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createViteServer } from "vitest/node";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const args = process.argv.slice(2);
const flag = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const verbose = args.includes("--verbose");
const record = args.includes("--record");
const REPLAYS = "public/name-extraction/replays";
/** A Replay above this is too heavy to ship to every visitor. */
const REPLAY_MAX_BYTES = 600_000;
const ids = args.filter((arg) => !arg.startsWith("--"));

if (!process.env.NAME_EXTRACTION_AI_GATEWAY_API_KEY) {
  console.error(
    "NAME_EXTRACTION_AI_GATEWAY_API_KEY is not set (put it in .env.local).",
  );
  process.exit(1);
}

// Load the app's TypeScript as the app sees it: `@/` paths, and `server-only` as a no-op.
const server = await createViteServer({
  root,
  configFile: false,
  logLevel: "error",
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/src/` },
      {
        find: /^server-only$/,
        replacement: `${root}/node_modules/server-only/empty.js`,
      },
    ],
  },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});

type Card = { id: string; split: string; pages: number; title: string };
type Result = {
  corpusId: string;
  pages: number;
  status: string;
  score: {
    recall: number;
    precision: number;
    expected: number;
    truePositives: number;
    missed: string[];
  } | null;
  costUsd: number;
  ms: number;
  analystCalls: number;
  readerCalls: number;
  names: number;
  error?: string;
  replay?: unknown;
};

try {
  const contract = await server.ssrLoadModule(
    "/src/features/name-extraction/domain/contract.ts",
  );
  const corpus = await server.ssrLoadModule(
    "/src/features/name-extraction/domain/corpus/index.ts",
  );
  const evaluation = await server.ssrLoadModule(
    "/src/features/name-extraction/server/eval.ts",
  );
  const cards = corpus.corpusCards() as Card[];
  const split = flag("split") ?? "test";
  const chosen = ids.length
    ? ids
    : cards.filter((card) => card.split === split).map((card) => card.id);
  const models = {
    analyst: flag("analyst") ?? contract.DEFAULT_MODELS.analyst,
    reader: flag("reader") ?? contract.DEFAULT_MODELS.reader,
  };
  console.log(
    `Sieve eval · ${chosen.length} documents · Analyst ${models.analyst} · Readers ${models.reader}\n`,
  );
  const results: Result[] = [];
  for (const id of chosen) {
    const result = (await evaluation.evaluateCorpus(
      id,
      models,
      (event: { type: string; text?: string }) => {
        if (!verbose) return;
        if (event.type === "thought" || event.type === "log")
          console.log(`  [${event.type}] ${event.text}`);
        else
          console.log(`  [${event.type}]`, JSON.stringify(event).slice(0, 200));
      },
      { record },
    )) as Result;
    results.push(result);
    const score = result.score;
    console.log(
      [
        id.padEnd(9),
        `${String(result.pages).padStart(3)}p`,
        result.status.padEnd(9),
        score ? `recall ${(score.recall * 100).toFixed(1)}%` : "recall –",
        score
          ? `precision ${(score.precision * 100).toFixed(1)}%`
          : "precision –",
        `$${result.costUsd.toFixed(3)}`,
        `${(result.ms / 1000).toFixed(0)}s`,
        `${result.analystCalls} turns · ${result.readerCalls} readers · ${result.names} names`,
      ].join("  "),
    );
    if (score?.missed.length)
      console.log(
        `           missed: ${score.missed.slice(0, 12).join("; ")}${score.missed.length > 12 ? " …" : ""}`,
      );
    if (result.error) console.log(`           error: ${result.error}`);
    if (record && result.replay) {
      if (result.status !== "completed") {
        console.log(`           not recorded: the Run ${result.status}`);
      } else {
        const json = `${JSON.stringify(result.replay)}\n`;
        const bytes = Buffer.byteLength(json);
        if (bytes > REPLAY_MAX_BYTES) {
          // Too heavy to ship; slim the trail further (domain/replay.ts) and record again.
          console.error(
            `           not recorded: ${id}'s Replay is ${(bytes / 1024).toFixed(0)} KB, over the ${(REPLAY_MAX_BYTES / 1000).toFixed(0)} KB limit`,
          );
          process.exitCode = 1;
          continue;
        }
        await mkdir(join(root, REPLAYS), { recursive: true });
        const file = join(root, REPLAYS, `${id}.json`);
        await writeFile(file, json);
        console.log(
          `           recorded ${REPLAYS}/${id}.json (${(bytes / 1024).toFixed(0)} KB)`,
        );
      }
    }
  }
  const scored = results.filter((result) => result.score);
  const expected = scored.reduce(
    (sum, result) => sum + (result.score?.expected ?? 0),
    0,
  );
  const found = scored.reduce(
    (sum, result) => sum + (result.score?.truePositives ?? 0),
    0,
  );
  console.log(
    `\nTotal: recall ${expected ? ((found / expected) * 100).toFixed(1) : "–"}% (micro) · $${results.reduce((sum, result) => sum + result.costUsd, 0).toFixed(3)} · ${(results.reduce((sum, result) => sum + result.ms, 0) / 1000).toFixed(0)}s`,
  );
} finally {
  await server.close();
}
