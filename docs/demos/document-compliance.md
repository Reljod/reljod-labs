# Document compliance: agent notes

Read this before you change `src/features/document-compliance/`, `src/app/demos/document-compliance/`, `src/app/api/document-compliance/` or `fixtures/document-compliance/`. The rules for every demo are in the root `AGENTS.md`; the layers are in `docs/engineering/architecture.md`.

- Domain language: `src/features/document-compliance/GLOSSARY.md` (map of all contexts: `GLOSSARY-MAP.md`). Read it before naming anything in `src/features/document-compliance/`.
- Decisions and their reasons: `docs/adr/`. Read before changing the parsing or evaluation pipeline.
- Synthetic documents: `fixtures/document-compliance/`. Every document uses the fictional Republic of Meridia and a SPECIMEN watermark.
- Rules are data, checks are code (`docs/adr/0019-document-compliance-rules-are-data-with-an-audit-trail.md`). A Rule's sentence, Parameters and Default live in `domain/rules.ts`; a new value is a Rule edit, a new kind of check is code in `domain/evaluate.ts`. Every Parameter a check reads comes from the `Rulebook` that `resolveRulebook` builds, never a constant.
- Rules page `/demos/document-compliance/rules`, Audit trail `/demos/document-compliance/audit`; a run page has Pipeline and Audit tabs and Re-evaluate (code only, no model call). A new action goes in `AUDIT_ACTIONS` (`domain/audit.ts`) and the `audit_events` check constraint together. Writes that must land with their event go through the database functions in `supabase/migrations/20261117170000_document_compliance_rules_audit.sql`; that migration must be applied before this code is deployed.

## Layers

- **Services** (`server/services/`): `runs.ts` (start a Pre-screen, list and read runs, stream a run's events, re-evaluate, Reviewer decisions), `rules.ts` (list, Versions, save, restore), `audit.ts` (the trail), `packs.ts` (a preset page image), `prescreen.ts` (what each workflow step does: parse, read, verify, Field checks, evaluate, save, audit). They take a `Caller` (Owner, the actor the Audit trail names, visitor), scope every read by id to the Owner and throw `@/platform/errors`.
- **Ports** (`server/ports.ts`), with their adapters: `RunRepository` (`server/repository.ts`), `RuleRepository` (`server/rules.ts`), `AuditLog` (`server/audit.ts`), `PackStore` (`server/supabase.ts`, Storage only), `DocumentParser` (`server/parsers.ts`, free, in the app), `DocumentReader` (the paid step: `server/extract.ts` live, `server/scripted-reader.ts` stubbed) and `PrescreenWorkflow` (start and stream, wired in `server/container.ts`).
- **Container** (`server/container.ts`): `documentCompliance(mode)`. Stubbed, only the reader changes.
- **REST** (`server/api.ts` is the base stack; routes in `src/app/api/document-compliance/`):
  - `GET /runs` the Owner's runs; `POST /runs` `{ packSlug }` starts a Pre-screen (201 `{ runId }`; a cap answers 429 with `runId`, the latest stored run of the pack to show instead).
  - `GET /runs/[runId]` one run, whole; `GET /runs/[runId]/events?from=` its ScanEvents as NDJSON.
  - `POST /runs/[runId]/evaluations` re-evaluates with the Owner's current Rules (201 `{ number, changes }`); `POST /runs/[runId]/reviews` `{ requirementId, evaluation, outcome, note }` records a Reviewer decision (204).
  - `GET /rules`; `PATCH /rules/[ruleId]` `{ enabled?, params? }` saves the next Version (`{ version }`; a refused edit is a 400 with `errors`, one per Parameter); `GET /rules/[ruleId]/versions`; `POST /rules/[ruleId]/versions/[version]/restore`.
  - `GET /audit?runId=&action=&before=` the trail, a page at a time.
  - `GET /packs/[slug]/[file]` a 302 to a short-lived signed URL of a preset page image.
  - The browser reaches them only through `components/api.ts`. There are no server actions.
- **Pages** read their first view through the same services (`initialFor` in `server/initial.ts`: the gate once, the request's mode, then `Promise.all`).
- **Workflow** (`server/prescreen-workflow.ts`): its file path and function names are replay keys; never rename or move them. Steps only stream and call `services.prescreen`; a stubbed run carries `stub: true` in its input, so its steps use the scripted reader too.

## Caps, data and env

- Caps are `LIMITS` in `domain/limits.ts` (5 Pre-screens per visitor per hour, 100 a day; re-evaluations and Reviewer decisions per run; Rule saves per hour). The Pre-screen caps are taken in the same transaction as the run's insert, under an advisory lock, by `document_compliance.create_prescreen_run` (`supabase/migrations/20261127130200_document_compliance_take_run.sql`): never count and insert in two calls. The e2e suite (a trusted visitor) passes no caps.
- Data lives in the `document_compliance` schema, reached directly on the shared pool (`db()` from `@/server/postgres`), not through the Data API. A run's detail is read in one round of the pool: every query is scoped to the Owner through the run. Files go to the private `document-compliance` bucket through supabase-js Storage (`server/supabase.ts`, which does nothing else). Env: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`, optional `DOCUMENT_COMPLIANCE_MODEL`; shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`.
- `server/rate-limit.ts` only re-exports `hashVisitor` and `E2E_VISITOR` for features that still import them from here; delete it once nothing does.

## Tests and stubbing

- e2e (`e2e/document-compliance.spec.ts`, `e2e/document-compliance-rules.spec.ts`) runs stubbed by default: the real parser, Storage, database, workflow, gates and caps, with `scriptedReader` instead of the model. It knows what each preset pack prints (the values `fixtures/document-compliance/generate.py` renders; change both together) and finds each value among the parsed Spans, correcting OCR misreads inside them as the model is told to, so code verifies its readings exactly as it does a model's. `E2E_LIVE=1` reaches the real model (paid; only when asked).
- Unit tests: `server/services/services.test.ts` (caps before the paid step, Owner scope, refusals that write nothing, readings verified whatever the reader says), the domain checks (`domain/*.test.ts`), the parser on the preset packs (`server/parsers.test.ts`), and `server/repository.db.test.ts` against a throwaway Postgres (`pnpm test:demo-db`).
