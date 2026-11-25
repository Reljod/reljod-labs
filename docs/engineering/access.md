# Access and Owners

The invariants are in the root `AGENTS.md` ("Every demo"). Read this before you change `src/features/access/`, `src/proxy.ts`, a Guest pass flow, or add a table that holds a person's data. Domain language: `src/features/access/GLOSSARY.md`.

## Access (the gate in front of the demos)

- The demos call a paid model, so `/demos/*`, `/ask/*`, `/api/casework/*`, `/api/client-manager/*`, `/api/document-compliance/*`, `/api/process-transfer/*`, `/api/harness/*`, `/api/name-extraction/*`, `/api/operator/*`, `/api/bank/*`, `/api/loupe/*`, `/api/switchboard/*`, `/api/canvas/*`, `/api/vellum/*`, `/api/prism/*`, `/api/helio/*` and `/api/floorwalk/*` (the `matcher` in `src/proxy.ts` is the list) open only to a Host (a Supabase Auth account) or a Guest on a live Guest pass. `/`, `/about` and the catalog at `/demos` itself stay public (the proxy matches `/demos/:path+`, not `/demos`).
- Two gates, both required. `src/proxy.ts` turns visitors away before a demo page or route runs. Every server action and route handler of a demo also calls `requireAccess()` (or `accessOrDenied()`) from `src/features/access/server/gate.ts`, because a server action can be posted to any page. A new demo entry point must do the same, and a new demo path must be added to the proxy matcher.
- A Guest is an anonymous Supabase Auth user. Anyone can become one, so an Auth session alone grants nothing: Access comes from a row binding the user to a live Guest pass, written only by `access.redeem_guest_pass`.
- Env: `SUPABASE_PUBLISHABLE_KEY` (or the legacy `SUPABASE_ANON_KEY`; server only, never `NEXT_PUBLIC_`), `ACCESS_HOST_EMAILS` (comma-separated; empty means nobody is a Host); shares `RATE_LIMIT_SALT`. A request carrying `E2E_BYPASS_TOKEN` passes the gate. Data lives in the Supabase `access` schema (listed under Data API > Exposed schemas). Anonymous sign-ins must be enabled in Supabase Auth.
- A Host's pages are `/access/profile` (name, password, the way into guest access) and `/access/guests`. The header's profile menu (`components/profile-menu.tsx`) asks the server who is signed in only when the `labs_profile` hint cookie is present, so public pages stay static; that cookie carries no authority.
- A daily cron job deletes every anonymous Auth user older than a day that is not on a live Guest pass, project-wide. A new feature that uses anonymous sign-ins must narrow that job first.
- Limits live in `LIMITS` in `src/features/access/domain/guest-pass.ts`; the migration's check constraints repeat the duration and device caps.
- On `/access/guests` a Host can extend or renew a pass, give it a new Guest code (signs out the devices on the old one, keeps the data), revoke, delete (marks it, purged after 30 days) and restore. A pass that ended 30 days ago is deleted by cron, so purged 30 days after that.

## Saved data belongs to an Owner

Decision: `docs/adr/0011-saved-data-belongs-to-an-owner.md`.

- Every row a demo saves for a person carries `owner text`: `host:<auth user id>`, `guest:<guest pass id>` or `e2e` (`src/features/access/domain/owner.ts`). Get it from `requireOwner()` in `src/features/access/server/gate.ts`.
- The one exception is seed data, shared with everyone and read-only: Client Manager sample clients (`is_sample`, `owner` null, created only by the seed script or e2e) and the Casework Cabinet (`case_file_slug`). Anything a visitor creates is owned, never a sample.
- Scope every list and every load by id to the Owner, in the server function. Never scope saved data by a browser cookie, an id in the URL, or the visitor hash. A cookie may only remember which of the Owner's own records is open, and must be checked against the Owner. Rate limits stay on the visitor hash.
- A Guest's data belongs to their Guest pass, not to the anonymous Auth user, so it survives the user's cleanup, a new Guest code and an extension. Never key Guest data on `userId`.
- Never hard-delete an Owner's data from a user action on a Guest pass. Deleting a pass sets `deleted_at`; `access.purge_deleted_guest_passes` (cron) purges the pass and its data 30 days later (`LIMITS.retentionDays`), and the Host can restore it until then.
- A new table that holds an Owner's top-level rows registers itself in its migration: `insert into access.owned_tables values ('<schema>.<table>') on conflict do nothing`. Child tables reach it by `on delete cascade`; register any that do not. Unregistered tables are never purged.
- Apply migrations to the live project with the Supabase MCP tools only when the user asks. Additive changes (new nullable columns, new tables) go first and stay safe for the code already deployed.
