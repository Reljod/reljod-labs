# Handover (process transfer): agent notes

Read this before you change `src/features/process-transfer/`, `/demos/process-transfer`, `/api/process-transfer/*`, `fixtures/process-transfer/` or `e2e/process-transfer.spec.ts`. The rules for every demo are in the root `AGENTS.md`; the layers are in `docs/engineering/architecture.md`.

- A live demo at `/demos/process-transfer`: a Recording of a handover call becomes a Process, a workflow document (DOCX) and a Deck (PPTX) that is approved only when its Checks pass. Domain language: `src/features/process-transfer/GLOSSARY.md`. Decision: `docs/adr/0020-a-deck-is-laid-out-by-code-and-approved-by-checks.md`.
- `domain/run.ts` is the contract: the workflow writes a `RunView`, the row stores it, the screen shows it. A Stage changes a Run by emitting a `patch`, which is also written to the row.
- Rules are data in `domain/rules.ts`; the Checks that apply them are in `domain/process-checks.ts` and `domain/deck-checks.ts`, keyed by Rule id. A new Rule needs both, and a test that it can fail.
- The preview, the Checks and the PPTX all come from the laid-out `Deck` (`domain/deck-layout.ts`). Never position anything in `pptx.ts` or `slide-view.tsx` that is not in the Deck. Layout spacing comes from the Rules' Parameters, and a deck the engine lays out from a plan within the content limits must pass every default Rule.
- DOCX and PPTX are built in the browser (`domain/docx.ts`, `domain/pptx.ts`, hand-written OOXML zipped with `fflate`); the server stores no generated files, only uploaded Recordings. After changing either, render it (LibreOffice in Docker) and run the Open XML SDK validator; neither is part of CI.
- Samples: `fixtures/process-transfer/` (README there; HyperFrames compositions and local Kokoro voices, Meridia, SPECIMEN), rendered to `public/process-transfer/samples/` with `pnpm render:process-transfer-samples`. `expected/<slug>.json` is the ground truth for each.
- Env: `PROCESS_TRANSFER_AI_GATEWAY_API_KEY` (required, no fallback); `DATABASE_URL`; shares `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the `process_transfer` schema (`supabase/migrations/20261118120000_process_transfer.sql`), reached directly through Handover's own pool (`server/db.ts`: its rows keep postgres.js's default parsers, so `timestamptz` is a `Date`). Uploads go to the private `process-transfer` bucket through signed upload URLs, under `recordings/<owner>/` (registered for the Owner purge).
- Watch needs a model that takes video (`MODELS[id].video`). Limits are `LIMITS` in `domain/limits.ts`; the caps on paid work are `domain/caps.ts` over counts the repository reads in one statement (`workTotals`: the Owner's spend today, Runs and Redos started this hour by the visitor and today by everyone), plus the one-active-Run unique index.
- An upload's length is read from every box that declares it (`recordingLength` in `domain/uploads.ts`): `mvhd`, and each track's `tkhd`, `mdhd` and `stts`, each in its own time scale. The longest is checked against `LIMITS.uploadSeconds`. A file is refused before the Watch call when the movie header and the longest track differ by more than 2 s or 5%, when a track's `stts` and `stsz` disagree on the sample count, when it is fragmented (`moof`/`mvex`, whose samples are not read), or when its declared length implies under 8 kbit/s (`MIN_RECORDING_BITS_PER_SECOND`, below a speech-only call). Samples keep the plain `mvhd` reading. The Watch call's output is capped by `LIMITS.watchOutputTokens`; its input is bounded only by the Recording's size and length, since the AI SDK has no input-token cap.

## Layers

- **Services** (`server/services/`): `runs.ts` (`RunService`: the Desk, one Run, the Audit trail, uploads, start, stop, Redo, downloads and the event replay; every read by id is scoped to the Owner and every path that adds paid work checks the caps first), `settings.ts` (`SettingsService`: Rules and models, each change versioned and audited) and `pipeline.ts` (`PipelineService`: what each workflow step does). They throw `@/platform/errors`; `server/errors.ts` keeps only `RunError`, the marker for a Stage failure message written for people.
- **Ports** (`server/ports.ts`): the Runs, settings and Audit repositories, the Recording store, the workflow (`RunWorkflows`), a step's live feed (`RunFeed`, the row and the stream together) and the `Analyst`, which is every model call a Stage makes.
- **Containers**: `server/container.ts` (`handover`, for routes and the page) and `server/pipeline-container.ts` (`pipeline`, for the workflow's steps; apart so the steps never import the workflow starter).
- **Workflow**: `server/run-workflow.ts` keeps `processTransferRun` and its steps (`beginStep`, `watchStep`, …, `stoppedStep`). Their names and the file are replay keys: never rename or move them. Each step body calls the pipeline service.
- **Page**: `src/app/demos/process-transfer/page.tsx` reads the Desk and the Run in the address through `handover(mode)` behind `<Suspense>`, one gate call for both.
- **Client**: `components/api.ts` wraps every route (`getJson`, `send`, `attempt`); `followRun` follows a Run's NDJSON events and reconnects from `?from=`.

## Endpoints

All under `/api/process-transfer`, on `handoverApi` (`server/api.ts`: same-origin writes, the gate and the Owner, the visitor hash, the services).

| Method and path | What |
| --- | --- |
| `GET /desk` | Runs, Rules, models, spend and the Run still going |
| `GET /audit?before=&run=` | A page of the Audit trail, newest first |
| `POST /uploads` | A one-time upload URL for a Recording, under the Owner's folder |
| `POST /runs` | Starts a Run on a Sample or the Owner's upload; `{ runId }` |
| `GET /runs/[runId]` | One Run with its model calls; 404 for anyone else's |
| `GET /runs/[runId]/events?from=` | The Run's events as NDJSON; a finished Run's replay ends once it goes quiet |
| `POST /runs/[runId]/stop` | Marks the row stopped, then cancels the workflow (best effort); 204 |
| `POST /runs/[runId]/redo` | Design, Check and Approve again under the current Rules; `{ runId }` |
| `POST /runs/[runId]/exports` `{ kind }` | Writes a DOCX or PPTX download to the Audit trail; refused for an unapproved Deck; 204 |
| `PUT /rules/[ruleId]` `{ override }` | One Rule's override (`null` is the default); the Rules as saved |
| `DELETE /rules` | Every Rule back to its default |
| `PUT /models` | The Watch, Write and Review models |

## Stubbing and e2e

An e2e request without `x-e2e-live: 1` is stubbed: the Runs it starts carry `stub: true` in the workflow's input, and `pipeline({ stub })` gives their steps the scripted Analyst (`server/stages/scripted.ts`): a five-step Process built from the Sample's title, people and length, a reviewer that finds nothing, and a Deck planned by rule (`planFromProcess`, `fitPlan`). No model is called and no cost is recorded. The Checks, the Approval, the workflow, the row, the stream and the Audit trail stay real, so a Rule the suite changes changes the result. `e2e/process-transfer.spec.ts` runs a Sample to Approved, saves a Rule (`process.step-count` min 6) and sees the Redo hold the Deck under Rules v1, and refuses another Owner's Run on every route; it cleans the `e2e` Owner's rows itself. The spec expects the scripted Analyst (no calls, an approved first Deck), so it is not meant for `E2E_LIVE=1`.
