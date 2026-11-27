# Architecture: REST over services

Read this before you add an endpoint, a write, a model call or an MCP tool to any demo. Floorwalk (`src/features/floorwalk/server/`, `src/app/api/floorwalk/`) is the smallest complete example.

## The layers

```
browser ─ components/api.ts ─┐
                             ├─► src/app/api/<demo>/**/route.ts ─┐
MCP client ─ server/mcp.ts ──┤      (thin: stack + schema)       ├─► service (server/service.ts …)
workflow step ───────────────┘                                   │     business rules, caps, Owner scope
page server component ───────────────────────────────────────────┘           │
                                                                     ports (server/ports.ts, interfaces)
                                                                             │
                                                         adapters wired in server/container.ts
                                                         (Postgres, model gateway, Storage, Sandbox, stubs)
```

- **Service** (`server/service.ts`, or `server/services/<area>.ts` when a demo has several areas): an exported `interface XService` and a `createXService(ports)` factory. All business logic lives here: validation beyond shape, Owner scoping, caps (`rate.take` before the first paid step), state rules, audit writes. A service never imports `next/*`, reads headers or cookies, or knows about HTTP. It throws the errors in `src/platform/errors.ts` (`InvalidError` 400, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `LimitError` 429), and the REST layer, the MCP server and workflows all map them the same way.
- **Ports** (`server/ports.ts`): TypeScript interfaces for everything outside the process the service needs: repositories (the SQL), the model, Storage, a Sandbox, the clock, `later` (Next's `after`). A service gets them as arguments, so a unit test hands in fakes and never mocks a module.
- **Adapters**: the existing SQL modules, model calls and Storage helpers, implementing the ports. A repository is usually an object literal over the feature's existing query functions.
- **Container** (`server/container.ts`): `container(({ stub }) => createXService({...}))` from `src/platform/services/container.ts`. The one place adapters are chosen. `stub` is true only for e2e requests without `x-e2e-live: 1`; it swaps paid adapters (model, Sandbox, paid search) for canned ones and keeps everything else real (gates, caps, database).
- **REST** (`src/app/api/<demo>/…/route.ts`): a route is a stack and a handler, nothing else.

```ts
// server/api.ts: the feature's base stack, defined once
export const floorwalkApi = api("floorwalk")
  .use(sameOrigin())     // CSRF guard on POST/PUT/PATCH/DELETE (server actions had it built in)
  .use(withOwner())      // the Access gate + the Owner every row is scoped to
  .use(withVisitor())    // the salted visitor hash caps count against
  .use(withServices(floorwalk));

// a route adds only its own layers
export const POST = floorwalkApi
  .use(body(askRequestSchema))
  .handle(({ services, owner, visitor, body }) => services.ask({ owner, visitor }, body));
```

A handler returns a value (sent as `private, no-store` JSON, with an ETag on GET), `undefined` (204), or a `Response` (`ndjson(events)` for streams, `json(value, { cache: CACHE.seed, request })` for shared seed data). Whatever a layer or handler throws becomes `{ error }` with the right status (`failure` in `src/platform/http/respond.ts`); an unknown error is logged and answered as a bare 500.

## Middleware

All in `src/platform/http/middleware.ts`. Each one adds to the context or refuses; stack them with `.use()`.

| Layer | Adds | Refuses |
| --- | --- | --- |
| `sameOrigin()` | | 403 for a write from another site |
| `withAccess()` / `withOwner()` | `access` / `access`, `owner` | 401 without Access |
| `withVisitor()` | `visitor` | |
| `withServices(container)` | `services` | |
| `authorize(policy)` | | 403 with the policy's reason |
| `body(schema, { limit })`, `query(schema)`, `params(schema)` | `body`, `query`, `path` | 400 (413 over the size limit) |

`derive(fn)` and `guard(fn)` in `src/platform/http/pipeline.ts` make new layers. **RBAC** is a policy: a function from the context to a refusal reason or `null`. Harness's Staff Roles are `withStaff()` plus `authorize(permits("rule.edit"))`; a site-wide root Role later is one more policy over `access`, stacked the same way, with no route rewritten.

## Endpoints

- Resources, not procedures: `GET /api/<demo>/runs`, `POST /api/<demo>/runs`, `GET|PATCH|DELETE /api/<demo>/runs/[id]`, and a sub-resource for a state change that is not an edit (`POST /runs/[id]/stop`).
- Only create an endpoint a screen or a client needs. One view reads in one request: a route that a screen calls in a loop (one request per row) is an N+1, so return the rows with what the screen shows of each, joined or batched in one query in the repository (`where id = any(${ids})`, a lateral join), never a query per row.
- Writes answer with the written resource, so the client applies it without a second read.
- No server actions. A form posts with `send()` from `src/platform/client/api.ts`; `attempt()` turns an `ApiError` into the `{ ok, error }` a write button shows where it was clicked.

## Browser client

`src/platform/client/api.ts`: `getJson`, `send`, `streamJson`, `readNdjson`, `attempt`, `ApiError`. A feature's `components/api.ts` keeps only typed wrappers over its routes (`ROUTES` in `domain/api.ts`). Components never call `fetch` for the demo's own routes.

## Database

- `db()` from `src/server/postgres.ts` is the one pool of a function instance. A feature whose rows need other type parsers (bank's camelCase) keeps its own pool, built once.
- Rate limits: `pgRateLimiter({ table, caps })` from `src/platform/rate/limiter.ts`. One query counts every cap; old hits are swept on about one take in 25, not every one.
- A statement count per answer: run with `DB_STATS=1` and read `x-db-queries`; `scripts/bench-api.mts` uses it.

## Tests

- Unit tests are for invariants whose failure makes the app wrong: a gate or Owner scope that lets someone in, a cap taken after the money is spent, a Rule check that cannot fail, a ledger that does not balance. Test the service with fake ports; do not test a route's wiring or a component's markup.
- e2e runs stubbed by default (`x-e2e-token` alone). `E2E_LIVE=1` (or a spec's own `*_LIVE` switch sending `x-e2e-live: 1`) reaches the real model; only when asked.
