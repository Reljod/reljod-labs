# Vellum (a vision model redraws a screenshot; code measures it): agent notes

Read this before you change `src/features/vellum/`, `/demos/vellum`, `/api/vellum/*`, `fixtures/vellum/` or `e2e/vellum.spec.ts`. The rules for every demo are in the root `AGENTS.md`.

- A live demo at `/demos/vellum` in two places (Trace, Under the hood): GPT-6.2 Astra redraws a screenshot as a vector Drawing, mark by mark, and the Ruler scores it against the pixels and sends the worst Cells back for another Pass. Domain language: `src/features/vellum/GLOSSARY.md`. Decision: `docs/adr/0034-vellum-the-model-draws-the-browser-measures.md`.
- A Drawing is data in the grammar `vellum.drawing/1` (`domain/drawing.ts`), never markup. Everything the model returns goes through `sanitizeDrawing`/`sanitizeMark` before it is drawn; the SVG writer (`domain/svg.ts`) escapes every string. A new kind of Mark changes the grammar, the sanitizer, `svg.ts` and `components/stage.tsx` together.
- Only `domain/ruler.ts` scores (pure; run in the browser by `components/raster.ts`). A later Pass gets Notes as numbers and hex only; every sentence the model reads is written by `domain/brief.ts`.
- One route spends: `POST /api/vellum/passes` (NDJSON). It checks the gate, the request and every image (`preparePass`) before `takePass`, then calls the model. Caps are `LIMITS` in `domain/limits.ts`.
- Nothing is saved: no Owner data, no bucket. The only table is `vellum.rate_hits` (`supabase/migrations/20261119170000_vellum.sql`, added with `git add -f`; apply it before deploying).
- Env: `VELLUM_AI_GATEWAY_API_KEY` (falls back to `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`), optional `VELLUM_MODEL` (default `openai/gpt-6.2-astra`), `VELLUM_REASONING` (`low`, `medium` or `high`; default `low`), `VELLUM_DATABASE_URL` (falls back to `CLIENT_MANAGER_DATABASE_URL`); shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`.
- Samples: four fictional Meridia screens, HTML in `fixtures/vellum/` (README there), rendered to `public/vellum/samples/` with `pnpm render:vellum-samples`.
- Tests: `e2e/vellum.spec.ts` runs stubbed by default (`x-vellum-stub` with the e2e token: a canned Drawing through the real route and Ruler, no model, no database write). `E2E_VELLUM_LIVE=1` asks the real model (about a dollar a Trace); run it only when asked.
