# AGENTS.md

## Testing

- Verify changes with `pnpm test` (unit tests), `pnpm lint`, `pnpm typecheck` and `pnpm build`. The `ci` workflow runs the first three on every pull request.
- Conventions learned in review (read before adding a paid model call or a user-facing limit): `docs/engineering/conventions.md`.
- Run the Playwright end-to-end suite (`pnpm test:e2e`) only when the user explicitly asks for it in the current conversation. It calls the paid model through Vercel AI Gateway, writes to the live Supabase project and takes several minutes per run. In CI it runs against a production build (`next start`); locally against `next dev` unless `E2E_SERVER=prod`.

## Document compliance

- Domain language: `src/features/document-compliance/GLOSSARY.md` (map of all contexts: `GLOSSARY-MAP.md`). Read it before naming anything in `src/features/document-compliance/`.
- Decisions and their reasons: `docs/adr/`. Read before changing the parsing or evaluation pipeline.
- Synthetic documents: `fixtures/document-compliance/`. Every document uses the fictional Republic of Meridia and a SPECIMEN watermark.
- Rules are data, checks are code (`docs/adr/0019-document-compliance-rules-are-data-with-an-audit-trail.md`). A Rule's sentence, Parameters and Default live in `domain/rules.ts`; a new value is a Rule edit, a new kind of check is code in `domain/evaluate.ts`. Every Parameter a check reads comes from the `Rulebook` that `resolveRulebook` builds, never a constant.
- Rules page `/demos/document-compliance/rules`, Audit trail `/demos/document-compliance/audit`; a run page has Pipeline and Audit tabs and Re-evaluate (code only, no model call). A new action goes in `AUDIT_ACTIONS` (`domain/audit.ts`) and the `audit_events` check constraint together. Writes that must land with their event go through the database functions in `supabase/migrations/20261117170000_document_compliance_rules_audit.sql`; that migration must be applied before this code is deployed.

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

## Client Manager

- A live demo at `/demos/client-manager` in two tabs: Chat (Threads in a sidebar, the Desk) and Clients (the Catalog and the open Client file: Profile, Map, Documents). An Intake builds a Client graph.
- Domain language: `src/features/client-manager/GLOSSARY.md`. Decisions: `docs/adr/0008-client-graph-on-pgrouting.md`, `docs/adr/0009-self-correcting-build.md`, `docs/adr/0010-desk-reads-the-graph-through-mcp.md`.
- The Desk reaches the graphs only through the MCP server (`src/features/client-manager/server/mcp.ts`, `/api/client-manager/mcp`, which checks its own bearer like Casework's). A new read of the graph is a new MCP tool, not a chat-only tool. Outside clients sign in with OAuth (`domain/oauth.ts`, consent at `/demos/client-manager/mcp/authorize`, decision `docs/adr/0012-mcp-clients-sign-in-with-oauth.md`) or paste a token from `/demos/client-manager/mcp`; a Guest's token is checked against their Guest pass on every call.
- Threads and Research proposals need `supabase/migrations/20261114120000_client_manager_threads.sql`.
- The graph is in the `client_manager` schema (`supabase/migrations/20261110200000_client_manager.sql`) and needs the `vector` and `pgrouting` extensions. The app connects directly with `CLIENT_MANAGER_DATABASE_URL` (Supabase transaction pooler, port 6543), not the Data API. Files and portraits go to the private `client-manager` bucket through signed upload URLs.
- Env: `CLIENT_MANAGER_DATABASE_URL`; optional `CLIENT_MANAGER_AI_GATEWAY_API_KEY` (falls back to `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`), `CLIENT_MANAGER_MODEL`, `CLIENT_MANAGER_CRITIC_MODEL`, `CLIENT_MANAGER_CHAT_MODEL`, `CLIENT_MANAGER_IMAGE_MODEL`; shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`.
- Sample documents: `fixtures/client-manager/` (HTML sources, Meridia, SPECIMEN), rendered to `public/client-manager/samples/` with `pnpm render:client-manager-samples`. Sample clients: `pnpm seed:client-manager` against a running app.

## Handover (process transfer)

- A live demo at `/demos/process-transfer`: a Recording of a handover call becomes a Process, a workflow document (DOCX) and a Deck (PPTX) that is approved only when its Checks pass. Domain language: `src/features/process-transfer/GLOSSARY.md`. Decision: `docs/adr/0020-a-deck-is-laid-out-by-code-and-approved-by-checks.md`.
- `domain/run.ts` is the contract: the workflow writes a `RunView`, the row stores it, the screen shows it. A Stage changes a Run by emitting a `patch`, which is also written to the row.
- Rules are data in `domain/rules.ts`; the Checks that apply them are in `domain/process-checks.ts` and `domain/deck-checks.ts`, keyed by Rule id. A new Rule needs both, and a test that it can fail.
- The preview, the Checks and the PPTX all come from the laid-out `Deck` (`domain/deck-layout.ts`). Never position anything in `pptx.ts` or `slide-view.tsx` that is not in the Deck. Layout spacing comes from the Rules' Parameters, and a deck the engine lays out from a plan within the content limits must pass every default Rule.
- DOCX and PPTX are built in the browser (`domain/docx.ts`, `domain/pptx.ts`, hand-written OOXML zipped with `fflate`); the server stores no generated files, only uploaded Recordings. After changing either, render it (LibreOffice in Docker) and run the Open XML SDK validator; neither is part of CI.
- Samples: `fixtures/process-transfer/` (README there; HyperFrames compositions and local Kokoro voices, Meridia, SPECIMEN), rendered to `public/process-transfer/samples/` with `pnpm render:process-transfer-samples`. `expected/<slug>.json` is the ground truth for each.
- Env: `PROCESS_TRANSFER_AI_GATEWAY_API_KEY` (required, no fallback); `PROCESS_TRANSFER_DATABASE_URL` (falls back to `CLIENT_MANAGER_DATABASE_URL`); shares `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the `process_transfer` schema (`supabase/migrations/20261118120000_process_transfer.sql`), reached directly like Client Manager's; uploads go to the private `process-transfer` bucket through signed upload URLs.
- Watch needs a model that takes video (`MODELS[id].video`). Limits are `LIMITS` in `domain/limits.ts`.

## Harness (Jod: Harness for Bank)

- A live demo at `/demos/harness` in six tabs (Chat, Pipelines, Knowledge, Skills, Audit, Docs) plus Demo mode: a chat Agent set up for the Pensions Operations Desk of the fictional Harbour Bank & Trust. Tabs are addressable: `?tab=`, `?session=`, `?run=`. It opens with the shared `DemoBar` (`rowFrom="xl"`, one row only from 1280px): the six places are its view tabs (ids `harness-tab-<tab>`, panels `harness-panel-<tab>`, which Demo mode's focus ring in `harness.css` keys on), and Connect Claude, Demo mode and the Staff switcher sit on its right. The Connect and consent pages use `HarnessPageBar` (`components/harness-bar.tsx`), the same bar with the places as links.
- Domain language: `src/features/harness/GLOSSARY.md`. Read it before naming anything in `src/features/harness/`: a Session is not a Thread, a Step is not a Job, a Staff member is not a Member. Decisions: `docs/adr/0013-harness-one-mcp-server-for-chat-and-claude.md` to `docs/adr/0018-audit-events-are-append-only.md`.
- The Agent reaches everything through the Harness MCP server (`/api/harness/mcp`). A new capability is a new MCP tool, never a chat-only tool; the only chat-local tools are `load_skill` and web search. No tool gives an Approval.
- Every entry point calls `requireStaff()` (or `staffOrDenied()` in a route) from `src/features/harness/server/context.ts`: it passes the Access gate, creates the Owner's Workspace with its seed on first use, and returns `{ access, owner, staff, visitor }`. The `harness_staff` cookie only remembers which of the Owner's own Staff is active and is checked against the Owner on every request.
- Roles are decided in one place: `can(staff, action)` in `domain/permissions.ts`. A server function that writes calls `requirePermission(action)`, or `assertCan(staff, action)` when it is handed a Staff member. High-risk Approvals need an admin who did not start the Run (`approvalRefusal`). Anyone in a Workspace may switch Staff, so a Role is not a security boundary between visitors; Access and the Owner are.
- Every server function that writes calls `audit()` (or `auditIn(tx, …)` inside its transaction, when the write and its event must stand or fall together) from `server/audit.ts`, with an action from the fixed list in `domain/audit.ts`. Details hold ids, names and sizes, never a secret or a whole document. `harness.audit_events` refuses UPDATE and DELETE; events go only when the Workspace does.
- The HTTP contract is `domain/api.ts` (paths, request and response types, the `ROUTES` table). The browser calls it only through `components/api.ts`; route handlers answer errors through `failure()` in `server/respond.ts`. Tabs build from `components/ui.tsx` (the Colonnade primitives: `Panel`, `Button`, `Badge`, `inputClass`, `segmentClass` for a row of pressed choices) and read `useHarness()`; Demo mode drives them through the controller registry (`useController`), never through a component's internals.
- Rules are data, checks are code (ADR 0015): Defaults in `domain/rules/defaults.ts`, edits as Versions in `harness.rule_versions`, checks as pure functions in `domain/pipelines/`. Only code returns a Finding. Skills are `SKILL.md` text; a Rulebook's body is rendered from its Rules.
- Caps live in `LIMITS` in `domain/limits.ts`; hourly ones are taken with `takeRate()` in `server/rate.ts`, in the server function, at every entry point (app, chat, MCP).
- A file attached in chat is a pending Source ("attached, not filed", ADR 0016): `api.sources.attach` uploads it and stops, so it has no Passages and no Conflict check. The Agent reads it (`read_source` returns its text) and a Pipeline takes it (`readSourceText`); `list_sources` and search never return it; `list_attachments` and the "Attached in this Session" list in the Agent's instructions (built each turn from the database, `server/attachments.ts`) do. Tools that take a Source id also accept a file name or title of one of the caller's Session's attachments, resolved only on a single match (`resolveSourceRef` in `domain/attachments.ts`); without a Session (an outside MCP client) only ids work. A Source's Preview (`GET /api/harness/sources/[id]/preview`) returns its raw text and a 5-minute signed link to its file, audited as `source.read`. It is filed only by the Agent's `file_source` or a person's File button in the Knowledge tab, which is also the only place a file is uploaded and read in one go.
- Data lives in the `harness` schema and the private `harness` bucket (created by the first migration). Apply four migrations, in this order: `supabase/migrations/20261117120000_harness.sql` (needs the `vector` extension), `20261117130000_harness_pipelines.sql`, `20261117150000_harness_knowledge.sql`, `20261117160000_harness_search_rate.sql`. The migrations and `public/harness/samples/*` are added with `git add -f` because of a global gitignore. Every table carries `owner` and cascades from `harness.workspaces`, the only Harness table in `access.owned_tables`; never register another, or the Owner purge fails on the Audit trail.
- Env: `HARNESS_DATABASE_URL` (falls back to `CLIENT_MANAGER_DATABASE_URL`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT` (shared; it also signs every Harness token, so rotating it revokes them), and `JOD_BANKING_HARNESS_AI_GATEWAY_API_KEY` (falls back to `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`). Optional: `HARNESS_MODEL`, `HARNESS_STEP_MODEL`, `HARNESS_EMBEDDING_MODEL`, `HARNESS_SANDBOX_URL` and `HARNESS_SANDBOX_SECRET` (both unset means the Sandbox is off; the URL must be https or loopback http; the Runner is `sandbox-runner/`, see its README: it refuses to start without `RUNNER_RUNTIME=runsc` (gVisor) or an explicit `RUNNER_ALLOW_RUNC=1`, and holds each visitor to `RUNNER_MAX_PER_OWNER` (default 2) Sandboxes), `E2E_BYPASS_TOKEN`.
- Sample data: `node --experimental-strip-types scripts/build-harness-samples.mts` writes the sample Schedules and remittance advice, and `scripts/build-harness-knowledge.mts` the seed Knowledge Sources (`seed-texts.ts`, from `fixtures/harness/knowledge/`) and the sample Circular and fee workbook, under `public/harness/samples/`. Re-run them after changing the sample book or the knowledge fixtures.
- Tests: `e2e/harness.spec.ts` is skipped unless `E2E_HARNESS=1` and needs the four migrations applied to the project it runs against. The chat turn is stubbed (`x-harness-stub` with the e2e bypass token, no model spend); it still writes to the `e2e` Workspace and uploads a sample to Storage. Run it only when the user asks, like the rest of the suite.
- Demo mode opens only from the bar's Demo mode button, never by itself (a dismissible "Continue where you left off" hint may be offered). Its six Scenarios are data in `components/demo-mode/scenarios.ts`; a Beat that needs a tab's controller opens that tab first, because a tab mounts when it is first visited.

## Sieve (Name Extraction)

- A live demo at `/demos/name-extraction`: one Analyst agent lists every party named in a 10 to 500 page AML document, recall first. Domain language: `src/features/name-extraction/GLOSSARY.md`. Decision: `docs/adr/0019-one-analyst-with-tools-not-a-pipeline.md`; research and cost model: `docs/research/name-extraction.md`.
- No fixed pipeline. The Analyst picks its tools (`domain/contract.ts` `TOOLS`): Readers (sub-agents over page ranges), Skills (`src/features/name-extraction/skills/`), `run_code` in a Vercel Sandbox with no network, and the model-free Sweep. The harness owns the Done gate and the caps (turns, Readers, USD); the model never does.
- Each Analyst turn and each tool call is a Workflow step (`server/run-workflow.ts`, `server/analyst.ts`). Every event goes to `name_extraction.run_events`, the append-only Audit trail.
- Corpus: generated from seeds in `domain/corpus/` (README in `fixtures/name-extraction/`), splits train/validation/test, every split with a 500-page Document. Tune the Sweep on train and validation only. `pnpm render:name-extraction-corpus` rewrites the manifest and the sample PDFs.
- `pnpm eval:name-extraction [ids] [--split=]` runs the real Analyst against the Corpus without a server or database. It spends money and starts Sandboxes: run it only when asked.
- Env: `NAME_EXTRACTION_AI_GATEWAY_API_KEY`; optional `NAME_EXTRACTION_MCP_TOKEN`; the Sandbox authenticates with OIDC (automatic on Vercel, `VERCEL_OIDC_TOKEN` from `vercel env pull` locally). Shares `RATE_LIMIT_SALT` and `E2E_BYPASS_TOKEN`. Data lives in the Supabase `name_extraction` schema (listed under Data API > Exposed schemas, migration `20261117200000_name_extraction.sql`) and the private `name-extraction` bucket.
- `sandbox-quickstart/` is the standalone Vercel Sandbox smoke test (`pnpm exec tsx index.ts` there prints `Hello from generated code`).

## Access (the gate in front of the demos)

- The demos call a paid model, so `/demos/*`, `/ask/*`, `/api/casework/*`, `/api/client-manager/*`, `/api/process-transfer/*`, `/api/harness/*` and `/api/name-extraction/*` open only to a Host (a Supabase Auth account) or a Guest on a live Guest pass. `/` and `/about` stay public. Domain language: `src/features/access/GLOSSARY.md`.
- Two gates, both required. `src/proxy.ts` turns visitors away before a demo page or route runs. Every server action and route handler of a demo also calls `requireAccess()` (or `accessOrDenied()`) from `src/features/access/server/gate.ts`, because a server action can be posted to any page. A new demo entry point must do the same, and a new demo path must be added to the proxy matcher.
- A Guest is an anonymous Supabase Auth user. Anyone can become one, so an Auth session alone grants nothing: Access comes from a row binding the user to a live Guest pass, written only by `access.redeem_guest_pass`.
- Env: `SUPABASE_PUBLISHABLE_KEY` (or the legacy `SUPABASE_ANON_KEY`; server only, never `NEXT_PUBLIC_`), `ACCESS_HOST_EMAILS` (comma-separated; empty means nobody is a Host); shares `RATE_LIMIT_SALT`. A request carrying `E2E_BYPASS_TOKEN` passes the gate. Data lives in the Supabase `access` schema (listed under Data API > Exposed schemas). Anonymous sign-ins must be enabled in Supabase Auth.
- A Host's pages are `/access/profile` (name, password, the way into guest access) and `/access/guests`. The header's profile menu (`components/profile-menu.tsx`) asks the server who is signed in only when the `labs_profile` hint cookie is present, so public pages stay static; that cookie carries no authority.
- A daily cron job deletes every anonymous Auth user older than a day that is not on a live Guest pass, project-wide. A new feature that uses anonymous sign-ins must narrow that job first.
- Limits live in `LIMITS` in `src/features/access/domain/guest-pass.ts`; the migration's check constraints repeat the duration and device caps.
- On `/access/guests` a Host can extend or renew a pass, give it a new Guest code (signs out the devices on the old one, keeps the data), revoke, delete (marks it, purged after 30 days) and restore. A pass that ended 30 days ago is deleted by cron, so purged 30 days after that.

## Saved data belongs to an Owner (rules for every demo)

- Every row a demo saves for a person carries `owner text`: `host:<auth user id>`, `guest:<guest pass id>` or `e2e` (`src/features/access/domain/owner.ts`). Get it from `requireOwner()` in `src/features/access/server/gate.ts`. Decision: `docs/adr/0011-saved-data-belongs-to-an-owner.md`.
- The one exception is seed data, shared with everyone and read-only: Client Manager sample clients (`is_sample`, `owner` null, created only by the seed script or e2e) and the Casework Cabinet (`case_file_slug`). Anything a visitor creates is owned, never a sample.
- Scope every list and every load by id to the Owner, in the server function. Never scope saved data by a browser cookie, an id in the URL, or the visitor hash. A cookie may only remember which of the Owner's own records is open, and must be checked against the Owner. Rate limits stay on the visitor hash.
- A Guest's data belongs to their Guest pass, not to the anonymous Auth user, so it survives the user's cleanup, a new Guest code and an extension. Never key Guest data on `userId`.
- Never hard-delete an Owner's data from a user action on a Guest pass. Deleting a pass sets `deleted_at`; `access.purge_deleted_guest_passes` (cron) purges the pass and its data 30 days later (`LIMITS.retentionDays`), and the Host can restore it until then.
- A new table that holds an Owner's top-level rows registers itself in its migration: `insert into access.owned_tables values ('<schema>.<table>') on conflict do nothing`. Child tables reach it by `on delete cascade`; register any that do not. Unregistered tables are never purged.
- Apply migrations to the live project with the Supabase MCP tools only when the user asks. Additive changes (new nullable columns, new tables) go first and stay safe for the code already deployed.

## Demo pages share one bar

- Every demo page opens with `DemoBar` (`src/components/demo/demo-bar.tsx`): the "All demos" back button (always `/#demos`, never a history back), the demo's number from `liveDemos` order, its name linking to the demo's first page, its places as tabs, and the demo's own controls on the right. A demo whose places and controls do not fit one row at 1024px passes `rowFrom="xl"`. Don't add a second back link inside a demo; a sub-page is reached and left through the tabs or the name.
- Demos are drawn in the Colonnade language of Document compliance: 2px ink outlines (`outline-box`), `rounded-sm`, hard offset shadows, `press` on everything clickable, `eyebrow` labels. No soft shadows or pill shapes.

## Buttons that write

- A button that writes is disabled while the write runs, shows a pending label, and shows the result or error where it was clicked. Destructive or hard-to-undo writes confirm first in a dialog (pattern: `ConfirmDialog` in `src/features/access/components/pass-actions.tsx`). Details: "A write button fires once" in `docs/engineering/conventions.md`.

## Analytics

- Vercel Web Analytics and Speed Insights load in `src/app/layout.tsx`. Turn both on in the Vercel project (Analytics and Speed Insights tabs); they collect only on Vercel deployments.
- Every pageview carries the flag `audience` (`host`, `guest` or `visitor`), read from the `labs_profile` hint cookie by `features/access/components/site-analytics.tsx`. Filter by it under Flags in the Analytics dashboard. The hint carries no authority, so the flag groups traffic and decides nothing.
- Sign-ins are custom events from `features/access/server/analytics.ts`: `Host signed in` and `Guest code redeemed`. Never put an email, a name or a Guest pass label in an event.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
