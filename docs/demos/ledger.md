# Ledger (the site's cat mascot): agent notes

Read this before you change `src/features/ledger/`, `/demos/ledger`, `/ask/*` or `e2e/ledger.spec.ts`. The rules for every demo are in the root `AGENTS.md`.

- A live demo at `/demos/ledger`. Ask sessions take apart the About page (`AboutSections`), not the landing page.
- Domain language: `src/features/ledger/GLOSSARY.md`. Decisions: `docs/adr/0006-llm-plans-what-browser-plans-where.md`, `docs/adr/0007-joins-are-ledgers-only-words-on-the-answer.md`.
- Env: `LEDGER_AI_GATEWAY_API_KEY`, optional `LEDGER_MODEL` (default `zai/glm-5.3-flash`); shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the Supabase `ledger` schema, which must be listed under Data API > Exposed schemas.
- Rate limits: `LIMITS` in `src/features/ledger/domain/limits.ts` (Builds per visitor per hour, Builds site-wide per day). `/ask/<id>/builds` takes a hit in `ledger.rate_hits` through `ledger.take_rate_hit` (advisory lock, count and insert in one transaction) before the model is called, so a dropped stream or parallel posts still count; `startAskSession` only peeks. Over a limit, the visitor gets a recent answer instead. Migration: `supabase/migrations/20261127110000_ledger_rate_hits.sql`.
- Anything on the About page Ledger may cut carries `source(sourcePath.…)`; the content tree in `src/features/ledger/domain/content-tree.ts` must name the same paths.
- `e2e/ledger.spec.ts` runs stubbed by default (canned Build plans, no model spend). `E2E_LEDGER_LIVE=1 pnpm test:e2e e2e/ledger.spec.ts` asks the real model; run it only when asked, like the rest of the suite.
