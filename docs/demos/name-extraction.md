# Sieve (Name Extraction): agent notes

Read this before you change `src/features/name-extraction/`, `/demos/name-extraction`, `/api/name-extraction/*`, `fixtures/name-extraction/` or `sandbox-quickstart/`. The rules for every demo are in the root `AGENTS.md`.

- A live demo at `/demos/name-extraction`: one Analyst agent lists every party named in a 10 to 500 page AML document, recall first. Domain language: `src/features/name-extraction/GLOSSARY.md`. Decision: `docs/adr/0021-one-analyst-with-tools-not-a-pipeline.md`; research and cost model: `docs/research/name-extraction.md`.
- No fixed pipeline. The Analyst picks its tools (`domain/contract.ts` `TOOLS`): Readers (sub-agents over page ranges), Skills (`src/features/name-extraction/skills/`), `run_code` in a Vercel Sandbox with no network, and the model-free Sweep. The harness owns the Done gate and the caps (turns, Readers, USD); the model never does.
- Each Analyst turn and each tool call is a Workflow step (`server/run-workflow.ts`, `server/analyst.ts`). Every event goes to `name_extraction.run_events`, the append-only Audit trail.
- Corpus: generated from seeds in `domain/corpus/` (README in `fixtures/name-extraction/`), splits train/validation/test, every split with a 500-page Document. Tune the Sweep on train and validation only. `pnpm render:name-extraction-corpus` rewrites the manifest and the sample PDFs.
- `pnpm eval:name-extraction [ids] [--split=]` runs the real Analyst against the Corpus without a server or database. It spends money and starts Sandboxes: run it only when asked.
- Env: `NAME_EXTRACTION_AI_GATEWAY_API_KEY`; outside MCP clients use a per-Owner token minted under "Connect a client"; the Sandbox authenticates with OIDC (automatic on Vercel, `VERCEL_OIDC_TOKEN` from `vercel env pull` locally). Shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the Supabase `name_extraction` schema (listed under Data API > Exposed schemas, migration `20261117200000_name_extraction.sql`) and the private `name-extraction` bucket.
- `sandbox-quickstart/` is the standalone Vercel Sandbox smoke test (`pnpm exec tsx index.ts` there prints `Hello from generated code`).
