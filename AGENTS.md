# AGENTS.md

## Testing

- Verify changes with `pnpm test` (unit tests), `pnpm lint` and `pnpm build`.
- Run the Playwright end-to-end suite (`pnpm test:e2e`) only when the user explicitly asks for it in the current conversation. It calls the paid OpenAI model, writes to the live Supabase project and takes several minutes per run.

## Document compliance

- Domain language: `GLOSSARY.md`. Read it before naming anything in `src/features/document-compliance/`.
- Decisions and their reasons: `docs/adr/`. Read before changing the parsing or evaluation pipeline.
- Synthetic documents: `fixtures/document-compliance/`. Every document uses the fictional Republic of Meridia and a SPECIMEN watermark.
