# AGENTS.md

## Testing

- Verify changes with `pnpm test` (unit tests), `pnpm lint` and `pnpm build`.
- Conventions learned in review (read before adding a paid model call or a user-facing limit): `docs/engineering/conventions.md`.
- Run the Playwright end-to-end suite (`pnpm test:e2e`) only when the user explicitly asks for it in the current conversation. It calls the paid model through Vercel AI Gateway, writes to the live Supabase project and takes several minutes per run. It needs the parser running on `PARSER_URL` (see `services/parser/README.md`).

## Document compliance

- Domain language: `src/features/document-compliance/GLOSSARY.md` (map of all contexts: `GLOSSARY-MAP.md`). Read it before naming anything in `src/features/document-compliance/`.
- Decisions and their reasons: `docs/adr/`. Read before changing the parsing or evaluation pipeline.
- Synthetic documents: `fixtures/document-compliance/`. Every document uses the fictional Republic of Meridia and a SPECIMEN watermark.

## Ledger (the site's cat mascot)

- A live demo at `/demos/ledger`. Ask sessions take apart the About page (`AboutSections`), not the landing page.
- Domain language: `src/features/ledger/GLOSSARY.md`. Decisions: `docs/adr/0006-llm-plans-what-browser-plans-where.md`, `docs/adr/0007-joins-are-ledgers-only-words-on-the-answer.md`.
- Env: `LEDGER_AI_GATEWAY_API_KEY`, optional `LEDGER_MODEL` (default `zai/glm-5.3-flash`); shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the Supabase `ledger` schema, which must be listed under Data API > Exposed schemas.
- Anything on the About page Ledger may cut carries `source(sourcePath.…)`; the content tree in `src/features/ledger/domain/content-tree.ts` must name the same paths.
- `e2e/ledger.spec.ts` runs stubbed by default (canned Build plans, no model spend). `E2E_LEDGER_LIVE=1 pnpm test:e2e e2e/ledger.spec.ts` asks the real model; run it only when asked, like the rest of the suite.

## Casework (the Specialist desk)

- A live demo at `/demos/casework`. Domain language: `src/features/casework/GLOSSARY.md`. Decision: `docs/adr/0007-jobs-as-mcp-tools-on-durable-workflows.md`.
- Jobs and Pipelines live in `src/features/casework/domain/jobs.ts` and `pipelines.ts`; each becomes an MCP tool on `/api/casework/mcp` automatically. Rules are pure functions in `domain/rules/`; only Sort, Read, Adjudicate and Decide call a model.
- Fixtures: `fixtures/casework/` (README there). Labels follow `domain/document-kinds.ts`; `golden.test.ts` scores the rules against them per train/validation/test split. Tune rules on train and validation only.
- Env: optional `CASEWORK_AI_GATEWAY_API_KEY` (falls back to `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`), optional `CASEWORK_MCP_TOKEN` for outside MCP clients, optional `CASEWORK_OCR=0`; shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the Supabase `casework` schema (listed under Data API > Exposed schemas) and the private `casework` bucket.

<!-- BEGIN:nextjs-agent-rules -->

## Access (the gate in front of the demos)

- The demos call a paid model, so `/demos/*`, `/ask/*` and `/api/casework/*` open only to a Host (a Supabase Auth account) or a Guest on a live Guest pass. `/` and `/about` stay public. Domain language: `src/features/access/GLOSSARY.md`.
- Two gates, both required. `src/proxy.ts` turns visitors away before a demo page or route runs. Every server action and route handler of a demo also calls `requireAccess()` (or `accessOrDenied()`) from `src/features/access/server/gate.ts`, because a server action can be posted to any page. A new demo entry point must do the same, and a new demo path must be added to the proxy matcher.
- A Guest is an anonymous Supabase Auth user. Anyone can become one, so an Auth session alone grants nothing: Access comes from a row binding the user to a live Guest pass, written only by `access.redeem_guest_pass`.
- Env: `SUPABASE_PUBLISHABLE_KEY` (or the legacy `SUPABASE_ANON_KEY`; server only, never `NEXT_PUBLIC_`), `ACCESS_HOST_EMAILS` (comma-separated; empty means nobody is a Host); shares `RATE_LIMIT_SALT`. A request carrying `E2E_BYPASS_TOKEN` passes the gate. Data lives in the Supabase `access` schema (listed under Data API > Exposed schemas). Anonymous sign-ins must be enabled in Supabase Auth.
- A Host's pages are `/access/profile` (name, password, the way into guest access) and `/access/guests`. The header's profile menu (`components/profile-menu.tsx`) asks the server who is signed in only when the `labs_profile` hint cookie is present, so public pages stay static; that cookie carries no authority.
- Limits live in `LIMITS` in `src/features/access/domain/guest-pass.ts`; the migration's check constraints repeat the duration and device caps.

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
