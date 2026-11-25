# Ledger (the site's cat mascot): agent notes

Read this before you change `src/features/ledger/`, `/demos/ledger`, `/ask/*` or `e2e/ledger.spec.ts`. The rules for every demo are in the root `AGENTS.md`.

- A live demo at `/demos/ledger`. Ask sessions take apart the About page (`AboutSections`), not the landing page.
- Domain language: `src/features/ledger/GLOSSARY.md`. Decisions: `docs/adr/0006-llm-plans-what-browser-plans-where.md`, `docs/adr/0007-joins-are-ledgers-only-words-on-the-answer.md`.
- Env: `LEDGER_AI_GATEWAY_API_KEY`, optional `LEDGER_MODEL` (default `zai/glm-5.3-flash`); shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the Supabase `ledger` schema, which must be listed under Data API > Exposed schemas.
- Anything on the About page Ledger may cut carries `source(sourcePath.…)`; the content tree in `src/features/ledger/domain/content-tree.ts` must name the same paths.
- `e2e/ledger.spec.ts` runs stubbed by default (canned Build plans, no model spend). `E2E_LEDGER_LIVE=1 pnpm test:e2e e2e/ledger.spec.ts` asks the real model; run it only when asked, like the rest of the suite.
