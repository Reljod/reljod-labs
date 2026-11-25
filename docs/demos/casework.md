# Casework (the Specialist desk): agent notes

Read this before you change `src/features/casework/`, `/demos/casework`, `/api/casework/*` or `fixtures/casework/`. The rules for every demo are in the root `AGENTS.md`.

- A live demo at `/demos/casework`. Domain language: `src/features/casework/GLOSSARY.md`. Decision: `docs/adr/0007-jobs-as-mcp-tools-on-durable-workflows.md`.
- Jobs and Pipelines live in `src/features/casework/domain/jobs.ts` and `pipelines.ts`; each becomes an MCP tool on `/api/casework/mcp` automatically. Rules are pure functions in `domain/rules/`; only Sort, Read, Adjudicate and Decide call a model.
- Fixtures: `fixtures/casework/` (README there). Labels follow `domain/document-kinds.ts`; `golden.test.ts` scores the rules against them per train/validation/test split. Tune rules on train and validation only.
- Env: optional `CASEWORK_AI_GATEWAY_API_KEY` (falls back to `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`), optional `CASEWORK_MCP_TOKEN` for outside MCP clients, optional `CASEWORK_OCR=0`; shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the Supabase `casework` schema (listed under Data API > Exposed schemas) and the private `casework` bucket.
