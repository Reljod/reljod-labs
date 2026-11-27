# Harness: known gaps

Things a review found that are deliberately not fixed yet. Each says what is wrong, why it was left, and the fix we expect to make. Remove an entry when its fix lands.

## Uploaded files outlive the Owner purge

**What.** `access.purge_owner` (ADR 0011) deletes an Owner's rows 30 days after their Guest pass is deleted. A Source's row goes; the file it points to does not. Uploaded files stay in the private `harness` bucket under `owners/<owner>/sources/<source id>/…` (`sourceStorageKey` in `src/features/harness/domain/knowledge/file-kind.ts`) for good. Removing one Source from the app does remove its file. The purge path is the one that does not.

**Why not fixed here.** Deleting from `storage.objects` in SQL inside the purge removes the row but leaves the stored object behind (orphaned, still billed), and Supabase advises against it. Objects must be removed through the Storage API. The `access` functions are shared by every demo and are not changed for one of them.

**Same gap elsewhere.** The Client Manager's private `client-manager` bucket (files and portraits under `clients/<id>/…`) has the same problem when its Owner is purged.

**Proposed fix.** Add a daily cron route, guarded like the other cron routes. It lists the top-level Owner prefixes of each bucket (`owners/` in `harness`, the client prefixes in `client-manager`), keeps those that still have a live Workspace or Client row, and removes the rest with `storage.from(bucket).remove(paths)`, in pages. Log the counts, never the names. It must run after `access.purge_deleted_guest_passes`, and an object is removed only when its owning row has been gone since the last run, so a file uploaded during the run is not taken.

## Owner is not part of the foreign keys

**What.** Child tables carry `owner` and reference their parent by id alone (for example `harness.passages.source_id references harness.sources (id)`, `harness.runs.started_by references harness.staff (id)`). Nothing in the schema stops a row whose `owner` differs from its parent's. Today every write path takes the parent from an Owner-scoped read, so no such row is written. The gap is latent.

**Why not fixed here.** It touches most Harness tables and every insert path, and none of the Harness migrations has been applied yet. It is better done once as its own change, with its own review.

**Proposed fix.** For each parent, add `unique (owner, id)`. In each child, replace the single-column reference with a composite one, for example:

```sql
alter table harness.sources add constraint sources_owner_id_key unique (owner, id);
alter table harness.passages
  drop constraint passages_source_id_fkey,
  add constraint passages_source_fkey
    foreign key (owner, source_id) references harness.sources (owner, id) on delete cascade;
```

Repeat this for staff (`started_by`, `saved_by`, `decided_by`, `staff_id`), sessions, runs, run_steps, findings, approvals and conflicts. Where the column may be null (`decided_by`, `session_id` with `on delete set null`), use `match simple` and `on delete set null (session_id)` (Postgres 15+) so the `owner` column is not nulled.

## One MCP token cannot be revoked by itself

**What.** Codes are now single-use and a Host can revoke all their tokens at once ("Disconnect all MCP clients", `docs/engineering/access.md`, "MCP tokens"). What is left: one connection cannot be revoked without the others, a second redemption of a code does not revoke the tokens the first one minted (RFC 6749 §4.1.2 says it should), and a Guest has no disconnect of their own (their tokens end with their Guest pass).

**Why not fixed here.** Per-connection revocation needs a row per issued Grant; the epoch needs one per Owner. The demo's exposure is small: a code's PKCE verifier is needed to redeem it, and a token acts only inside its Owner's Workspace.

**Proposed fix.** Add a `harness.oauth_grants` table, registered in `access.owned_tables`, with a row per Grant (`jti`, owner, staff, client name, callback host, expires_at, revoked_at), put the `jti` in the code, the refresh and access tokens, list the rows on the Connect page with a Disconnect per row, and check `revoked_at` in `verifyBearer`. On a second redemption of a code, revoke its Grant.

## Roles separate duties, not data, inside a Workspace

**What.** Any Staff member of a Workspace, a `user` included, can read a Source another Staff member attached in their own Session and has not filed yet (status `pending`). Roles decide what a Staff member may do (approve, edit Rules, use the Sandbox), not what they may see: every Staff member of a Workspace is the same visitor (ADR 0014), so there is no one to hide it from.

**Proposed fix, if Staff ever become separate people.** Scope reads of a pending Source to its Session: allow one only when its `session_id` is null or is a Session the caller may read (`readableSession`), in `readSource` and `readSourceText` (`server/knowledge.ts`) and wherever a Pipeline loads a Source by id (`sourcesOf`).
