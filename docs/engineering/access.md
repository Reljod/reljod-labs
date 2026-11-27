# Access and Owners

The invariants are in the root `AGENTS.md` ("Every demo"). Read this before you change `src/features/access/`, `src/proxy.ts`, a Guest pass flow, or add a table that holds a person's data. Domain language: `src/features/access/GLOSSARY.md`.

## Access (the gate in front of the demos)

- The demos call a paid model, so `/demos/*`, `/ask/*`, `/api/casework/*`, `/api/client-manager/*`, `/api/document-compliance/*`, `/api/process-transfer/*`, `/api/harness/*`, `/api/name-extraction/*`, `/api/operator/*`, `/api/bank/*`, `/api/loupe/*`, `/api/switchboard/*`, `/api/canvas/*`, `/api/vellum/*`, `/api/prism/*`, `/api/helio/*` and `/api/floorwalk/*` (the `matcher` in `src/proxy.ts` is the list) open only to a Host (a Supabase Auth account) or a Guest on a live Guest pass. `/`, `/about` and the catalog at `/demos` itself stay public (the proxy matches `/demos/:path+`, not `/demos`).
- Two gates, both required. `src/proxy.ts` turns visitors away before a demo page or route runs. Every route handler of a demo also passes the gate (`withAccess()` / `withOwner()` on the pipeline, or `requireAccess()` / `accessOrDenied()` from `src/features/access/server/gate.ts`), because a request can be sent to any route. A new demo entry point must do the same, and a new demo path must be added to the proxy matcher.
- A Guest is an anonymous Supabase Auth user. Anyone can become one, so an Auth session alone grants nothing: Access comes from a row binding the user to a live Guest pass, written only by `access.redeem_guest_pass`.
- Env: `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the Auth admin API and Storage only), `SUPABASE_PUBLISHABLE_KEY` (or the legacy `SUPABASE_ANON_KEY`; server only, never `NEXT_PUBLIC_`), `ACCESS_HOST_EMAILS` (comma-separated; empty means nobody is a Host); shares `RATE_LIMIT_SALT`. A request carrying `E2E_BYPASS_TOKEN` passes the gate. Data lives in the Supabase `access` schema, reached directly with postgres.js on the shared pool (`db()` from `src/server/postgres.ts`, re-exported as `sql` in `server/db.ts`), from the proxy too (it runs on the Node.js runtime); it is not exposed through the Data API. Anonymous sign-ins must be enabled in Supabase Auth.
- A Host's pages are `/access/profile` (name, password, the way into guest access, "Disconnect all MCP clients") and `/access/guests`. The header's profile menu (`components/profile-menu.tsx`) asks the server who is signed in (`GET /api/access/session`) only when the `labs_profile` hint cookie is present, so public pages stay static; that cookie carries no authority.

## The REST routes (`src/app/api/access/**`)

Architecture: `docs/engineering/architecture.md`. The services are in `server/services/` (`DoorService`, `ProfileService`, `GuestPassService`, `McpClientService`), behind the ports in `server/ports.ts`, wired in `server/container.ts` (`accessServices`). The routes are thin stacks from `server/api.ts`; the browser reaches them only through `components/api.ts`. The pages read through the same services (`accessServices().guestPasses.list(access)`). No paid adapter, so the stubbed e2e suite runs the real door.

| Route | Who | What |
| --- | --- | --- |
| `GET /api/access/session` | anyone | Who this browser is (null for a visitor); keeps the hint cookie in step |
| `POST /api/access/session` | anyone | A Host signs in `{ email, password, next? }` → `{ to }` |
| `DELETE /api/access/session` | anyone | Sign out (a Guest's device goes back to the pass) → `{ to }` |
| `POST /api/access/guest-session` | anyone | Redeem a Guest code `{ code, next }` → `{ to }` |
| `PATCH /api/access/profile` | Host | `{ name }` → `{ saved }` |
| `PUT /api/access/password` | Host | `{ current, next, confirm }` → `{ saved }`; counted like a sign-in |
| `POST /api/access/guest-passes` | Host | Issue `{ label, hours, devices }` → the Guest code, shown once |
| `POST /api/access/guest-passes/[id]/extend` | Host | Extend or renew `{ hours }` |
| `POST /api/access/guest-passes/[id]/code` | Host | A new Guest code; the devices on the old one are signed out |
| `POST /api/access/guest-passes/[id]/revoke` | Host | Revoke a live pass |
| `DELETE /api/access/guest-passes/[id]` | Host | Soft delete (purged after `LIMITS.retentionDays`) |
| `POST /api/access/guest-passes/[id]/restore` | Host | Restore a deleted pass |
| `DELETE /api/access/mcp-clients` | Host | Disconnect all MCP clients |

- The door's two routes (`DOOR_ROUTES` in `constants.ts`) are in the proxy matcher, and `decide()` passes them for everyone; every other `/api/access/*` path is passed only for a Host and refused (401) to anyone else, a new one included. The routes check again: `doorApi` (no gate) and `hostApi` (`withAccess()` + `authorize(isHost)`), and every Host-only service method refuses anyone but a Host itself (`asHost`). Every write goes through `sameOrigin()` first, so a cross-site form cannot sign anyone in or out.
- Refusals: a wrong code or password 401, the door's cap (`WAIT`) 429, a pass that is gone 404, the live-pass cap 429. When Supabase Auth cannot do its part (not set up, down, an update refused) the route answers 503 with what went wrong (`UnavailableError`, mapped by `unavailable()` in `server/api.ts`; the platform's errors stop at 429). On the two sign-in routes any other failure answers 503 "The door is not working right now", so a broken door says so and lets nobody in.
- Writes that need the page's list or name again call `router.refresh()` after they worked; the door's answers carry `{ to }`, which the browser loads in full (`use-leave.ts`) so nothing of the previous account stays in memory.
- e2e: `e2e/access.spec.ts` (no e2e token, an `x-forwarded-for` of its own so its one wrong code counts against no one, and is deleted after).
- A daily cron job deletes every anonymous Auth user older than a day that is not on a live Guest pass, project-wide. A new feature that uses anonymous sign-ins must narrow that job first.
- Limits live in `LIMITS` in `src/features/access/domain/guest-pass.ts`; the migration's check constraints repeat the duration and device caps.
- Tries at the door go through `takeAttempt` (`access.take_attempt`): the count and the insert are one step under an advisory lock, and the try is recorded as failed until `settleAttempt` marks it good. A visitor gets `LIMITS.failedAttempts` wrong tries per window; wrong Guest codes from everyone together are capped at `LIMITS.globalFailedCodeAttempts`, which blunts guessing from many addresses. The Host's sign-in has no global cap, so a flood of wrong codes never locks the Host out. Until the migration is applied, `takeAttempt` falls back to an unlocked count and insert.
- A Guest who leaves (sign out) gives their device back: their `guest_sessions` row is deleted, the pass and its data stay.
- Every response carries `X-Frame-Options: DENY`, `frame-ancestors 'none'`, HSTS, `nosniff` and a referrer policy (`domain/security-headers.ts`, applied in `next.config.ts`). A route that sets its own policy headers is listed in `OWN_POLICY_PATHS`. A script CSP (nonces from the proxy) is a follow-up.
- `RATE_LIMIT_SALT` shorter than 32 characters logs a warning once per process.
- On `/access/guests` a Host can extend or renew a pass, give it a new Guest code (signs out the devices on the old one, keeps the data), revoke, delete (marks it, purged after 30 days) and restore. A pass that ended 30 days ago is deleted by cron, so purged 30 days after that.

## MCP tokens (Client Manager, Harness, Guest access)

Decision: `docs/adr/0012-mcp-clients-sign-in-with-oauth.md` (amended). Shared code: `src/features/access/domain/mcp-clients.ts` and `src/features/access/server/mcp-tokens.ts`; tables in `20261127120000_access_mcp_tokens.sql`.

- Every MCP token (OAuth access and refresh tokens, pasted tokens, the apps' own chat tokens) carries `iat`, epoch seconds; a Grant's `iat` is its consent time and passes into every token minted from it. `verifyBearer` refuses a token issued at or before its Owner's token epoch (`access.token_epochs`), and one with no `iat` once the Owner has an epoch; without an epoch, tokens minted before `iat` existed keep working until they expire. The token endpoint verifies each token it mints, so a refresh token or code from before a disconnect mints nothing. The lookup is one primary-key read per request, never cached across requests.
- A Host's "Disconnect all MCP clients" (`/access/profile`, `DELETE /api/access/mcp-clients` → `McpClientService.disconnectAll`, confirmed in a dialog) moves their epoch to now. Every client they connected must sign in again. Guests have no button: their tokens end with their Guest pass.
- An authorization code is redeemed once: its hash goes into `access.redeemed_oauth_codes` through `access.redeem_oauth_code`, which also clears rows an hour past their expiry.
- Anyone can register a client with any https callback and any `client_name`. The consent page names it as "an app that calls itself …", warns, and keeps Allow off until "I trust <host>" is ticked, unless the callback is loopback http or on `KNOWN_CLIENT_HOSTS`; the consent route checks the tick again (`callbackVouched`; Client Manager: `POST /api/client-manager/mcp-consent` over `server/consent.ts`). Add a host there only for a client people really connect, by its exact callback host.
- The authorize page and the consent route send the browser to a callback only for a request with Access, or to a loopback or known callback; anything else is shown on the page, so they are no open redirect.
- `RATE_LIMIT_SALT` signs every token, and the readable payload carries the visitor hash `sha256(salt + ":" + ip)`, so a weak salt could be guessed offline from one token and a known IP. Keep it 32 or more random bytes. Deriving the signing keys with HKDF or keying the visitor hash would not raise the cost of a guess (both are as fast as the hash), and the visitor hash must stay what the rate limits count, so the tokens were left as they are.
- Before the migration is applied, a missing table reads as "no epoch, no code used yet" (as before it existed); any other database error fails closed.

## Guest access MCP server (Hosts only)

Decision: `docs/adr/0037-hosts-manage-guest-passes-over-mcp.md`. Code: `domain/guest-access-mcp.ts` (paths, tool list), `domain/guest-access-oauth.ts`, `server/mcp.ts` (the MCP server), `server/services/mcp-connect.ts` (consent, registration, tokens, the bearer check), both wired in `server/container.ts`.

- `/api/access/mcp` lets a Host manage Guest passes from Claude, Claude Code or any MCP client that signs in with OAuth. How to connect: `/access/mcp`, linked as "Connect Claude" from `/access/guests`. The tools (`list_guest_passes`, `issue_guest_pass`, `extend_guest_pass`, `new_guest_code`, `revoke_guest_pass`, `delete_guest_pass`, `restore_guest_pass`) call the same `GuestPassService` (`server/services/guest-passes.ts`) as the REST routes, with the Host the bearer acts for. A new pass action goes there first, then gets a route and a tool.
- OAuth is stateless, built from the shared `statelessOAuth` in `domain/mcp-oauth.ts`: issuer `/api/access` (metadata at `/.well-known/oauth-authorization-server/api/access`), resource metadata at `/.well-known/oauth-protected-resource/api/access/mcp`, `/api/access/oauth/register` and `/token` (on `openApi`, which the proxy lets through as `BEARER_ROUTES`), consent at `/access/mcp/authorize`, whose Allow and Deny post to `POST /api/access/mcp-consent` (on `hostApi`) and answer where the browser goes. Blobs carry the `ga` prefix and the `guest-access` HMAC context, so no Client Manager or Harness blob verifies here, and none of these verifies there.
- Only a Host can allow a client. The proxy sends anyone else from `/access/mcp*` to the Host sign-in with `next`, and `safeNextPath` lets `/access/mcp*` through. The consent service checks for a Host again and redirects nowhere for anyone else.
- A Grant lasts 30 days (`HOST_GRANT_DAYS`), and access tokens last an hour. Every MCP request and every token minted checks the account with the Auth admin API (`hostById`: not deleted, banned or anonymous, email confirmed and on `ACCESS_HOST_EMAILS`, the same email as at consent) and the Host's token epoch, so "Disconnect all MCP clients" covers this server too. A code is redeemed once (`redeemCodeOnce`).
- Guest codes come back in the client's chat when a pass is issued or given a new code. They are shown once there, as on the page.
- Guests and the e2e suite cannot connect.

## Saved data belongs to an Owner

Decision: `docs/adr/0011-saved-data-belongs-to-an-owner.md`.

- Every row a demo saves for a person carries `owner text`: `host:<auth user id>`, `guest:<guest pass id>` or `e2e` (`src/features/access/domain/owner.ts`). Get it from `requireOwner()` in `src/features/access/server/gate.ts`.
- The one exception is seed data, shared with everyone and read-only: Client Manager sample clients (`is_sample`, `owner` null, created only by the seed script or e2e) and the Casework Cabinet (`case_file_slug`). Anything a visitor creates is owned, never a sample.
- Scope every list and every load by id to the Owner, in the server function. Never scope saved data by a browser cookie, an id in the URL, or the visitor hash. A cookie may only remember which of the Owner's own records is open, and must be checked against the Owner. Rate limits stay on the visitor hash.
- A Guest's data belongs to their Guest pass, not to the anonymous Auth user, so it survives the user's cleanup, a new Guest code and an extension. Never key Guest data on `userId`.
- Never hard-delete an Owner's data from a user action on a Guest pass. Deleting a pass sets `deleted_at`; `access.purge_deleted_guest_passes` (cron) purges the pass and its data 30 days later (`LIMITS.retentionDays`), and the Host can restore it until then.
- A new table that holds an Owner's top-level rows registers itself in its migration: `insert into access.owned_tables values ('<schema>.<table>') on conflict do nothing`. Child tables reach it by `on delete cascade`; register any that do not. Unregistered tables are never purged.
- Files go too. `access.purge_owner` first queues the Owner's Storage prefixes in `access.storage_purge` (`access.enqueue_owner_storage`, migration `20261127150100_access_storage_purge.sql`), and the Vercel cron route `/api/cron/storage-purge` (daily, `vercel.json` `crons`) removes them through the Storage API, at most 10 batches of 500 objects a run. The route checks `Authorization: Bearer <CRON_SECRET>` in constant time and answers 404 to everyone while `CRON_SECRET` is unset; set it in the Vercel project. It is not behind the proxy.
- Queued today: Harness `owners/<owner>/`, Handover `recordings/<owner>/`, Loupe `u/` and `x/<hashed owner>/`, Sieve `uploads/<hashed owner>/`, Operator `manifests/<hashed owner>/` and `frames/<run id>/`, Casework `uploads/<desk id>/`, Client Manager `clients/<client id>/`, Canvas `canvas.uploads.storage_path`. Floorwalk's uploads expire within hours on their own. A demo that stores files under a new layout adds it to `access.enqueue_owner_storage` (a new migration, `create or replace`); a demo that later purges its own soft-deleted rows queues their files with `access.enqueue_storage_purge(bucket, prefix)` before deleting them. A prefix ending in `/` is a folder, anything else one object, and every prefix needs two segments.
- Apply migrations to the live project with the Supabase MCP tools only when the user asks. Additive changes (new nullable columns, new tables) go first and stay safe for the code already deployed.
