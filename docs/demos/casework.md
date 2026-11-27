# Casework (the Specialist desk): agent notes

Read this before you change `src/features/casework/`, `/demos/casework`, `/api/casework/*`, `e2e/casework.spec.ts` or `fixtures/casework/`. The rules for every demo are in the root `AGENTS.md`; the layers are `docs/engineering/architecture.md`.

- A live demo at `/demos/casework`. Domain language: `src/features/casework/GLOSSARY.md`. Decision: `docs/adr/0007-jobs-as-mcp-tools-on-durable-workflows.md`.

## Layers

- **Services** (`server/services/`), each an interface and a `create…Service(ports)` factory, with no `next/*`, headers or cookies: `desks.ts` (which Desk a request works in, what it shows, model settings, signed pages, the MCP token's Desk), `runs.ts` (readiness, starting a Run under the caps, Answers, stop, events), `uploads.ts` (slots and tickets), `chat.ts` (the Specialist's turn) and `work.ts` (what a Run's workflow steps do). They throw the errors in `src/platform/errors.ts`.
- **Ports** (`server/ports.ts`): the repository (`server/repository.ts`, the `casework` schema over the shared pool `db()`), Storage (`server/supabase.ts`), the workflows, the Reader (Sort, Read, Adjudicate, Decide) and the Specialist's model. Live adapters are in `server/adapters.ts`.
- **Containers**: `server/container.ts` (`casework`) for the routes, the page and the MCP route; `server/work-container.ts` (`runWork`) for the workflow steps, apart so the step bundle never imports the MCP server or the chat.
- **REST** (`server/api.ts`): `caseworkApi` is `sameOrigin → withOwner → withVisitor → withServices(casework)` plus the Desk id the browser remembers (the `casework_session` cookie, only a pointer among the Owner's own Desks). `withDesk({ create })` resolves the open Desk (creating one on first use for writes that need it, else 404) and tells the browser to remember it.
- **MCP** (`server/mcp.ts`, `createCaseworkMcp`): every Job and Pipeline is a tool over the same run and desk services; a refusal a service throws is the tool's error answer. Bearer-authenticated, off the cookie gate.
- **Workflow** (`server/run-workflow.ts`): step and workflow names and the file path are replay keys; never rename or move them. Step bodies call `runWork(ctx)` and stream the events.
- **Client** (`components/api.ts`): typed wrappers over `src/platform/client/api.ts`; components never call `fetch` for these routes.

## Endpoints (`ROUTES` in `domain/api.ts`)

| Method and path | What |
| --- | --- |
| `GET /api/casework/desk` | The open Desk's Runs, the Owner's Desks, the Spend (404 with no Desk) |
| `PUT /api/casework/desk` `{ deskId? }` | Opens a Desk with everything it shows: an earlier one (404 if not the Owner's), or the current one, created on first use |
| `POST /api/casework/desks` | A fresh Desk, opened |
| `PUT /api/casework/desk/settings/[purpose]` | One purpose's model settings |
| `DELETE /api/casework/desk/settings` | Back to the defaults |
| `POST /api/casework/desk/stop` | Stops whatever the open Desk has going |
| `POST /api/casework/chat` | One message to the Specialist, NDJSON `ChatEvent`s; a cap refuses with a JSON 429 before the model |
| `POST /api/casework/uploads` | Signed upload slots and tickets |
| `POST /api/casework/documents` `{ tickets }` | Records finished uploads as Documents |
| `GET /api/casework/documents/pages?ids=` | Signed pages (or a CSV's text) for up to 60 Documents |
| `GET /api/casework/runs/[runId]/events?from=` | A Run's events as NDJSON |
| `POST /api/casework/runs/[runId]/stop` | Stops one Run of the open Desk |
| `POST /api/casework/questions/[questionId]/answer` | Answers a waiting Run's Question |
| `GET/POST/DELETE /api/casework/mcp` | The MCP server (bearer) |

A Run, a Question or a Document of another Desk answers 404 like one that is not there. Starting a Run has no REST route: only the Specialist (or an outside MCP client) starts one, through its tools.

## Rules

- The desk's chat calls its own MCP server in-process with a session token (`sessionToken` in `server/session.ts`, minted per message by the container's MCP connector): a signed `{ sessionId, owner, exp }` that lives an hour (`SESSION_TOKEN_SECONDS`). The server refuses it once expired, and every tool checks the Desk still belongs to the token's Owner (`forToken` in `services/desks.ts`); only the outside client's desk (`CASEWORK_MCP_TOKEN`) has no Owner.
- Jobs and Pipelines live in `src/features/casework/domain/jobs.ts` and `pipelines.ts`; each becomes an MCP tool on `/api/casework/mcp` automatically. Rules are pure functions in `domain/rules/`; only Sort, Read, Adjudicate and Decide call a model (the Reader port).
- Fixtures: `fixtures/casework/` (README there). Labels follow `domain/document-kinds.ts`; `golden.test.ts` scores the rules against them per train/validation/test split. Tune rules on train and validation only.
- Env: `DATABASE_URL` (the Supabase transaction pooler, port 6543; the `casework` schema is reached directly with postgres.js through the shared pool `db()` in `src/server/postgres.ts`), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Storage only); optional `CASEWORK_AI_GATEWAY_API_KEY` (falls back to `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`), optional `CASEWORK_MCP_TOKEN` for outside MCP clients, optional `CASEWORK_OCR=0`; shares `RATE_LIMIT_SALT` (signs upload tickets and session tokens) and `E2E_BYPASS_TOKEN`. Data lives in the `casework` schema, reached directly (not through the Data API), and the private `casework` bucket (through supabase-js Storage). `pnpm seed:casework` needs the same three variables.
- Caps are `LIMITS` in `domain/limits.ts`, taken in the services at every entry point (REST, chat, MCP). A chat message takes its turn (`ChatService.turn`) before the model is called: the sending visitor's 40 an hour, the demo's daily turns, the Owner's daily spend summed over all their Desks, then the Desk's own $2, all in `casework.take_chat_turn` under one advisory lock. A new Desk resets only the Desk's cap, so its message offers a new desk only when the Owner still has room. A Run is counted and created in one step by `casework.create_run` (the Desk's visitor hour, demo day, one Run per Desk, the Owner's daily spend and the Desk's cap) before its workflow starts. A Desk the e2e suite opened (visitor hash `e2e`) skips the caps, as its requests do. Spend is recorded as model calls finish, so turns or a Run already in flight can take an Owner a little past a cap: at most one turn's cost per turn in flight. Both need `supabase/migrations/20261127130000_casework_caps.sql` applied before this code is deployed.
- Uploads: the browser's type, size and pages only open a slot. `UploadService.finish` records what Storage holds: the real size, the type checked by its first bytes, and only the page images that were stored (`domain/uploads.ts`). A ticket is signed, bound to its Desk, expires after two hours and is good once (an upload's path is recorded once; a unique index backs it). The bucket takes only PDF, CSV, JPEG and PNG up to 10 MB (`supabase/migrations/20261127130100_casework_uploads.sql`).
- Storage: the `casework` bucket holds the seeded Cabinet under `cabinet/<scenario>/<slug>/` and Desk uploads under `uploads/<session id>/<uuid>/` (the file and its `page-N.jpg` images). Deleting a Desk (the 30-day expiry cron, or an Owner purge) cascades its rows but leaves its `uploads/<session id>/` objects in Storage.

## Stubs and e2e

- A stubbed e2e request (the e2e token without `x-e2e-live: 1`) gets the stub container (`stubs.ts`): the Specialist's model is a script that, given attached Documents, calls the tool the message names (`pipeline_pension_withdrawal`, `job_sort`) or `review_documents` through the real MCP server, and the Runs it starts carry `ctx.stub`, so their steps read each Cabinet Document by its label (its Kind and fields) and the Rules write the Decision file. Nothing calls a model; the gates, caps, workflows and database are real.
- `e2e/casework.spec.ts` runs a pipeline to its Decision, stops a Run waiting on a Question, and reaches another Owner's Run and Desk by id (404). It deletes the `e2e` Owner's Desks (everything cascades) before and after. The workflow runs on the local world in `next dev`.
- `E2E_LIVE=1` reaches the real models (paid); run it only when asked.
