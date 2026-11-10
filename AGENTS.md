# AGENTS.md

## Testing

- Verify changes with `pnpm test` (unit tests), `pnpm lint` and `pnpm build`.
- Run the Playwright end-to-end suite (`pnpm test:e2e`) only when the user explicitly asks for it in the current conversation. It calls the paid model through Vercel AI Gateway, writes to the live Supabase project and takes several minutes per run. It needs the parser running on `PARSER_URL` (see `services/parser/README.md`).

## Document compliance

- Domain language: `src/features/document-compliance/GLOSSARY.md` (map of all contexts: `GLOSSARY-MAP.md`). Read it before naming anything in `src/features/document-compliance/`.
- Decisions and their reasons: `docs/adr/`. Read before changing the parsing or evaluation pipeline.
- Synthetic documents: `fixtures/document-compliance/`. Every document uses the fictional Republic of Meridia and a SPECIMEN watermark.

## Ledger (the site's cat mascot)

- A live demo at `/demos/ledger`. Ask sessions take apart the About page (`AboutSections`), not the landing page.
- Domain language: `src/features/ledger/GLOSSARY.md`. Decision: `docs/adr/0006-llm-plans-what-browser-plans-where.md`.
- Env: `LEDGER_AI_GATEWAY_API_KEY`, optional `LEDGER_MODEL` (default `zai/glm-5.3-flash`); shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the Supabase `ledger` schema, which must be listed under Data API > Exposed schemas.
- Anything on the About page Ledger may cut carries `source(sourcePath.…)`; the content tree in `src/features/ledger/domain/content-tree.ts` must name the same paths.
- `e2e/ledger.spec.ts` runs stubbed by default (canned Build plans, no model spend). `E2E_LEDGER_LIVE=1 pnpm test:e2e e2e/ledger.spec.ts` asks the real model; run it only when asked, like the rest of the suite.

<!-- BEGIN:nextjs-agent-rules -->

## Client Manager

- A live demo at `/demos/client-manager`: the Catalog, an Intake that builds a Client graph, and GraphRAG chat over it.
- Domain language: `src/features/client-manager/GLOSSARY.md`. Decisions: `docs/adr/0008-client-graph-on-pgrouting.md`, `docs/adr/0009-self-correcting-build.md`.
- The graph is in the `client_manager` schema (`supabase/migrations/20261110200000_client_manager.sql`) and needs the `vector` and `pgrouting` extensions. The app connects directly with `CLIENT_MANAGER_DATABASE_URL` (Supabase transaction pooler, port 6543), not the Data API. Files and portraits go to the private `client-manager` bucket through signed upload URLs.
- Env: `CLIENT_MANAGER_DATABASE_URL`; optional `CLIENT_MANAGER_AI_GATEWAY_API_KEY` (falls back to `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`), `CLIENT_MANAGER_MODEL`, `CLIENT_MANAGER_CRITIC_MODEL`, `CLIENT_MANAGER_CHAT_MODEL`, `CLIENT_MANAGER_IMAGE_MODEL`; shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`.
- Sample documents: `fixtures/client-manager/` (HTML sources, Meridia, SPECIMEN), rendered to `public/client-manager/samples/` with `pnpm render:client-manager-samples`. Sample clients: `pnpm seed:client-manager` against a running app.

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
