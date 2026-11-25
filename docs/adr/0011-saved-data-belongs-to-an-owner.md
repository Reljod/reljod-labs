# Saved data belongs to an Owner, and a Guest's data to their Guest pass

Every demo kept what a person saved under a browser cookie of its own: Client Manager's `client_manager_session`, Casework's `casework_desks`, the Pre-screen's `prescreen_session` (ADR 0007, run metrics and sessions), and Ledger's Ask sessions under an id in the URL that anyone could open. That predates Access. Now everyone who can save anything is a Host or a Guest, so the browser is the wrong key: a Guest's second device saw nothing, a Host lost their book on a new browser, and a Guest's data died with things that are meant to be thrown away (the anonymous Auth user, cleaned up a day after its pass ends, and the browser itself).

We key saved data on an **Owner**, written as text in an `owner` column on each demo's top-level rows: `host:<auth user id>`, `guest:<guest pass id>`, or `e2e` for the test suite. Server code reads it with `requireOwner()` and scopes every list and every load by id to it. A Guest's Owner is their Guest pass, not their Auth user, so every device on the pass shares one book, and it outlives a new Guest code, an extension or a renewal.

That makes the Guest pass the thing whose life decides the data's, so a pass is no longer deleted outright. A Host can extend or renew a pass, give it a new Guest code (which signs out every device on the old code; whoever enters the new one gets the same data) and delete it. Deleting sets `deleted_at` and takes Access away at once. Thirty days later `access.purge_deleted_guest_passes` (pg_cron) deletes the pass and, through `access.purge_owner`, every row its Guests saved; until then the Host can restore it. A pass that ended and was left alone for thirty days is deleted the same way.

We chose a text Owner over foreign keys to `auth.users` and `access.guest_passes` because one column covers both kinds and the e2e suite, and because a cascade from the Auth user is exactly what lost Guest data before. The price is that the database cannot find an Owner's rows by itself, so each owned table registers in `access.owned_tables` and the purge walks the registry.

## Consequences

- This supersedes the cookie Session of ADR 0007 (run metrics and sessions): a Pre-screen run is listed for its Owner, and `prescreen_runs.session_id` is no longer written.
- Rows saved before Owners have `owner` null and are shown to nobody. Client Manager samples (`is_sample`) stay visible to everyone.
- Casework keeps a cookie only to remember which of the Owner's desks is open; it is checked against the Owner on every read.
- Client Manager MCP tokens carry the Owner. Tokens minted before this change are refused. A Guest token stops working when the pass ends, is deleted, or gets a new code.
- Each demo's own expiry (`expires_at`, 30 days; 90 for Ledger) still applies on top of the Guest pass purge.
- Purging by SQL leaves files in the `client-manager` and `casework` buckets, as the existing expiry jobs already do.
- A new demo that saves data must add `owner`, scope by it, and register its table (`docs/engineering/access.md`, "Saved data belongs to an Owner").
