# AGENTS.md

## Testing

- Verify changes with `pnpm test` (unit tests), `pnpm lint` and `pnpm build`.
- Run the Playwright end-to-end suite (`pnpm test:e2e`) only when the user explicitly asks for it in the current conversation. It calls the paid model through Vercel AI Gateway, writes to the live Supabase project and takes several minutes per run. It needs the parser running on `PARSER_URL` (see `services/parser/README.md`).

## Document compliance

- Domain language: `GLOSSARY.md`. Read it before naming anything in `src/features/document-compliance/`.
- Decisions and their reasons: `docs/adr/`. Read before changing the parsing or evaluation pipeline.
- Synthetic documents: `fixtures/document-compliance/`. Every document uses the fictional Republic of Meridia and a SPECIMEN watermark.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
