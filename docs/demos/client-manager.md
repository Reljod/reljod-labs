# Client Manager: agent notes

Read this before you change `src/features/client-manager/`, `/demos/client-manager`, `/api/client-manager/*`, `fixtures/client-manager/`, `scripts/seed-client-manager.mts` or `e2e/client-manager.spec.ts`. The rules for every demo are in the root `AGENTS.md`; the layers are `docs/engineering/architecture.md`'s.

## The demo

- A live demo at `/demos/client-manager` in two tabs: Chat (Threads in a sidebar, the Desk) and Clients (the Catalog and the open Client file: Profile, Map, Documents). An Intake builds a Client graph.
- Domain language: `src/features/client-manager/GLOSSARY.md`. Decisions: `docs/adr/0008-client-graph-on-pgrouting.md`, `docs/adr/0009-self-correcting-build.md`, `docs/adr/0010-desk-reads-the-graph-through-mcp.md`.

## Layers

- **Services** (`server/services/`, each an interface and a `create…(ports)` factory, with no `next/*`, headers or cookies): `clients.ts` (the Catalog, the Client file and its Edges, facts and Sources, deleting a client, the Portrait), `builds.ts` (an Intake, an addition, facts from the Desk or a Research card, starting, stopping and watching a Build), `threads.ts` (Threads and a Desk question), `graph.ts` (every MCP tool's read of the graphs), `connect.ts` (the pasted MCP token, the OAuth consent's Allow and Deny, OAuth registration and the token endpoint) and `build-work.ts` (what each step of a Build's workflow does). Who may see or change a client is decided in one place, `services/scope.ts` (`canView`, `canChange`). They throw the errors in `src/platform/errors.ts`.
- **Ports** (`server/ports.ts`): the repositories (`repository.ts`, as object literals in `adapters.ts`), Storage (`storage.ts`), the caps (`caps.ts`), the Workflow SDK, and every paid model: the Desk (`assistant.ts`), the extractor (`extract.ts`), the Critic (`critic.ts`), the Persona, Portrait and embeddings (`persona.ts`).
- **Containers**: `server/container.ts` (`clientManager(mode)`) wires the services for requests, pages and the MCP route; `server/work-container.ts` (`buildWork(mode)`) wires a Build's steps, apart because `container.ts` imports the workflow it starts.
- **REST** (`server/api.ts`): `clientManagerApi` is `sameOrigin → withOwner → withVisitor → withServices(clientManager)` plus `caller` (`{ owner, visitor }`). `openApi` (services only) carries the routes that check their own bearer or need no Access (MCP, OAuth); `consentApi` reads the Access, which may be none, for the consent page. The HTTP contract (paths, schemas, response types) is `domain/api.ts`; the browser calls it only through `components/api.ts` (typed wrappers over `@/platform/client/api`; a refusal is an `ApiError`, `isGone` is its 404).
- **Pages** read their first view through the same services (`firstLoad` in `server/page.ts`: the gate once, then the Catalog, the Threads, the open client and the open Thread in parallel), behind `<Suspense>`, passed down as `initial…` props.

## Endpoints

All under `/api/client-manager`. A client, Build or Thread someone may not see answers 404 like one that is not there.

| Method and path | Does |
| --- | --- |
| `GET /clients` | The Catalog: the Samples and the Owner's own clients. Purges clients deleted 30 days ago after the answer. |
| `POST /clients` | An Intake: the client, its first Build and a signed upload URL per file. Takes the `build` cap first. |
| `GET /clients/[clientId]` | The Client file's first frame, in one statement. |
| `DELETE /clients/[clientId]` | Soft delete; stops a Build still going. Owner only. |
| `GET /clients/[clientId]/edges?scope=` | The Edges of one part of the Map (`root`, `branch:<id>`, `leaf:<id>`, `node:<key>`). A Sample's answer is `CACHE.seed`. |
| `GET /clients/[clientId]/node?key=` | One fact with its quotes and links. |
| `GET /clients/[clientId]/sources/[sourceId]` | One Source as it was read, with a signed link and the facts that quote it. |
| `POST /clients/[clientId]/builds` | An addition. Owner only; refused while a Build runs. |
| `POST /clients/[clientId]/portrait` | `upload` (where to PUT), `confirm` (only the exact path `upload` handed out, once it is in the bucket) or `paint` (under the `build` cap, before the image model). Owner only. |
| `POST /builds/[buildId]/start` | Starts the Build's workflow once its files are uploaded; of two starts, one runs. |
| `POST /builds/[buildId]/stop` | Cancels the workflow (best effort) and always closes the row. |
| `GET /builds/[buildId]/events?from=` | The Build's events as NDJSON; 404 until it has started. |
| `GET /threads`, `POST /threads` | The Owner's Threads; a new one, about every client or one. |
| `GET`, `PATCH`, `DELETE /threads/[threadId]` | A Thread with its messages (one round); rename or rescope it; soft delete. |
| `POST /threads/[threadId]/messages` | A question. The Thread's Owner and the cap are checked first (a refusal is a JSON error); the answer streams as NDJSON `AssistantEvent`s. |
| `POST /threads/[threadId]/proposals/[messageId]` | A Research card's pick: add the chosen facts (an addition Build, claimed once) or dismiss. |
| `POST /mcp-token` | Mints the visitor's MCP token to paste. |
| `POST /mcp-consent` | The consent page's Allow or Deny; answers where the browser goes. |
| `GET`, `POST`, `DELETE /mcp` | The MCP server (own bearer). |
| `POST /oauth/register`, `POST /oauth/token` | OAuth dynamic registration and the token endpoint (no Access; CORS). |

## Boundaries

- The Desk reaches the graphs only through the MCP server (`server/mcp.ts`, `createClientManagerMcp` over the graph and Build services), in process with a Desk token narrowed to the Thread's client. A new read of the graph is a new MCP tool (a method of `services/graph.ts`), not a chat-only tool. Outside clients sign in with OAuth (`domain/oauth.ts`, consent at `/demos/client-manager/mcp/authorize`, decision `docs/adr/0012-mcp-clients-sign-in-with-oauth.md`) or paste a token from `/demos/client-manager/mcp`; a Guest's token is checked against their Guest pass on every call. Every token carries `iat` and is refused once its Owner pressed "Disconnect all MCP clients"; a code is redeemed once; the consent page warns and needs "I trust <host>" ticked for a callback that is neither loopback nor a known client's, and never redirects a visitor without Access (`docs/engineering/access.md`, "MCP tokens"). The Desk's own chat tokens carry `iat` too, so they keep working after a disconnect.
- Caps are `LIMITS` in `domain/limits.ts` (refusals in the pure `refusalFor`). `pgCaps.take` (`server/caps.ts`) counts and writes the row that holds the place (the Build, the question) in one transaction under advisory locks on the visitor, the Owner and the global cap, before any model call: per visitor per hour, per visitor and per Owner USD per day, and Builds and questions per day for everyone. `pgCaps.check` checks without taking a place (painting a Portrait). Not `pgRateLimiter`: the place is the paid row itself, and the caps include spend. A search embeds its words only while the visitor's day of spend is under the cap, else it searches by words alone.
- A Sample is read-only: only the e2e suite and the seed script (a trusted visitor) add to or build one (`canChange`).
- Deletes are soft. Removing a client or a Thread sets `deleted_at`; every read (`getClient`, `clientFile`, `listCatalog`, `getThread`, `listThreads`, `buildWithClient`) filters it, and a Thread scoped to a deleted client reads with no client (`client_id` null), as the old `on delete set null` did. The purge cron removes Threads after 30 days; a deleted client's Storage folder and rows go in the Catalog read's purge, because SQL cannot empty Storage. Needs `supabase/migrations/20261127140000_soft_deletes_and_caps.sql`.
- An uploaded portrait is confirmed only for the exact path the upload step handed out (`isUploadedPortraitPath`) and only once the object is in the bucket.
- A Build is a durable workflow (`server/build-workflow.ts`). Its step and workflow names and that file's path are replay keys: never rename or move them. Each step calls the Build work service. `BuildInput.stub` tells its steps to use the canned models.

## Data and env

- The graph is in the `client_manager` schema (`supabase/migrations/20261110200000_client_manager.sql`) and needs the `vector` and `pgrouting` extensions. Threads and Research proposals need `supabase/migrations/20261114120000_client_manager_threads.sql`. `20261128150000_client_manager_rest_indexes.sql` indexes the caps' per-visitor counts of questions and spend (additive). The app connects directly with `DATABASE_URL` (Supabase transaction pooler, port 6543), not the Data API, through its own pool (`server/db.ts`): its rows keep `timestamptz` as `Date`s, where the shared `db()` parses them to strings. Files and portraits go to the private `client-manager` bucket through signed upload URLs.
- Env: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `CLIENT_MANAGER_AI_GATEWAY_API_KEY` (falls back to `DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`), `CLIENT_MANAGER_MODEL`, `CLIENT_MANAGER_CRITIC_MODEL`, `CLIENT_MANAGER_CHAT_MODEL`, `CLIENT_MANAGER_IMAGE_MODEL`; shares `RATE_LIMIT_SALT` (it also signs every MCP token and OAuth code) and `E2E_BYPASS_TOKEN`.
- Sample documents: `fixtures/client-manager/` (HTML sources, Meridia, SPECIMEN), rendered to `public/client-manager/samples/` with `pnpm render:client-manager-samples`. Sample clients: `pnpm seed:client-manager` against a running app; it sends `x-e2e-live: 1` so the real models read them.

## Tests

- `e2e/client-manager.spec.ts` runs stubbed by default (the e2e token alone): the stub container (`server/stubs.ts`) gives the Desk a script that searches the graphs through the real MCP server and answers with the facts it found, cited; a Build it starts carries `stub`, so its steps read with the canned extractor (the Elena Marsh example's facts by their quotes, one fact per sentence for any other text), a Critic that finds the graph clean, a canned Persona, a one-pixel Portrait and no embeddings. Nothing calls a model; the gates, caps, workflows, MCP server, Storage and the live database are real, and it writes an `e2e` client each run. `E2E_LIVE=1` reaches the models (paid). Run it only when the user asks, like the rest of the suite.
- Unit tests are the invariants: the services with fake ports (`server/services/service.test.ts`: Owner scope, Samples read-only, caps before the paid step, Stop always closes the row, a Research card adds once; `connect.test.ts`: consent and the single-use code), the Check and Repairs (`domain/graph.test.ts`), the caps (`domain/limits.test.ts`), tokens and OAuth (`domain/mcp-token.test.ts`, `domain/oauth.test.ts`, `server/mcp-auth.test.ts`) and Storage paths (`domain/file-name.test.ts`).
