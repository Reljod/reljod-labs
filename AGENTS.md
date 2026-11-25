# AGENTS.md

Reljod Labs is a Next.js site on Vercel: a public landing page and a catalog of live AI demos over fictional paperwork (the Republic of Meridia, every document watermarked SPECIMEN). The demos call paid models and write to a live Supabase project, so most of the rules below exist to keep cost, other people's data and the gates intact.

This file holds what applies everywhere. Each demo's own rules live in `docs/demos/`; read the one for the demo you are touching before you edit it (see "Demo notes" below).

## Your check loop

- Run `pnpm exec vitest run <the files you touched>` first, then `pnpm test`, `pnpm lint` and `pnpm typecheck`. Run `pnpm build` once before you push.
- Do not run the end-to-end suite yourself unless the user asks for it in the current conversation. It calls paid models through Vercel AI Gateway and writes to the live Supabase project. When asked, run only the test you added or changed, by location: `pnpm test:e2e e2e/<name>.spec.ts:<line>`. Otherwise the pull request's `e2e-changed` check runs it, so a change worth an e2e test carries the test in the same pull request.
- The same goes for anything else that spends money or starts sandboxes (`pnpm eval:*`, any `*_LIVE=1` switch): only when asked.
- How CI, `e2e-changed`, the post-merge suite and the `E2E_ENV` secret work: `docs/engineering/testing.md`.

## Conventions from review

`docs/engineering/conventions.md` holds lessons that cost a bug each. Read the matching section before you add a paid model call, a GitHub workflow, a user-facing limit, a demo read, a write button, a durable workflow, or anything that writes to Storage.

## Every demo

These hold for all demos. The detail and the reasons are in `docs/engineering/access.md` (Access, Owners, Guest passes).

- **Two gates.** A demo path is closed to anyone who is not a Host or a Guest on a live Guest pass. `src/proxy.ts` turns visitors away first, and every server action and route handler also calls `requireAccess()` (or `accessOrDenied()`) from `src/features/access/server/gate.ts`, because a server action can be posted from any page. A new demo path goes into the proxy matcher; a new entry point calls the gate.
- **Saved data belongs to an Owner.** Every row a demo saves for a person carries `owner` from `requireOwner()`, and every list and load is scoped to it in the server function, never by a cookie, a URL id or the visitor hash. Rate limits stay on the visitor hash. A Guest's data is keyed on the Guest pass, never the anonymous `userId`. A new top-level table registers itself in `access.owned_tables` in its migration, and child tables cascade from it.
- **Deletes are soft.** A user action on a Guest pass never hard-deletes an Owner's data; the purge cron does that after 30 days.
- **Migrations.** Apply them to the live project (Supabase MCP tools) only when the user asks. Additive changes go first so the deployed code keeps working. A global gitignore drops `.sql` and `.pdf`, so new migrations and sample PDFs need `git add -f`.
- **Bar and look.** Every demo page opens with `DemoBar` (`src/components/demo/demo-bar.tsx`): the "All demos" button (always `/demos`, never a history back), the demo's number from `liveDemos` order, its name linking to its first page, its places as tabs, and its own controls on the right. Pass `rowFrom="xl"` when they do not fit one row at 1024px. Add no second back link. Draw in the Colonnade language of Document compliance: 2px ink outlines (`outline-box`), `rounded-sm`, hard offset shadows, `press` on everything clickable, `eyebrow` labels, no soft shadows or pills.
- **Speed.** Reads go through gated GET routes in the Harness shape (`domain/api.ts`, `server/respond.ts`, `components/api.ts`), because Next runs a browser's server actions one at a time; writes stay server actions. A page reads its first view in its server component behind `<Suspense>` with a skeleton shaped like the screen, passes it down as `initial…` props, calls the gate once per request and runs independent reads together. Caching and loading UI: the sections from "A demo reads through GET routes" onward in `docs/engineering/conventions.md`.
- **Buttons that write** are disabled while the write runs, show a pending label, and show the result or error where they were clicked. Destructive or hard-to-undo writes confirm first in a dialog (`ConfirmDialog` in `src/features/access/components/pass-actions.tsx`). Details: "A write button fires once" in `docs/engineering/conventions.md`.

## Patterns the demos share

Most demos are built the same way. When a demo's notes say one of these, this is what it means:

- **Domain language is fixed.** Each feature has a `GLOSSARY.md` (map: `GLOSSARY-MAP.md`); read it before naming anything in that feature. Decisions and their reasons are in `docs/adr/`.
- **Rules are data, checks are code.** A Rule's values live in `domain/rules.ts` with Versions in the database; only pure check code returns a Finding, refuses or approves. A model never approves anything, and no tool gives an Approval. A new Rule needs its check and a test that it can fail.
- **One MCP server per agent.** The demo's agent reaches everything through its MCP server, so a new capability is a new MCP tool calling a server function the app also calls, never a chat-only tool.
- **Caps** are `LIMITS` in `domain/limits.ts`, taken in the server function at every entry point (app, chat, MCP).
- **Audit trails are append-only.** The database refuses UPDATE and DELETE on audit and event tables; every write that needs an event records it, inside the same transaction when both must stand or fall together.
- **Workflow and step names are replay keys.** Do not rename or move them; keep workflow files to pure imports.
- **Sandboxes** are Vercel Sandbox with no network, authenticated by OIDC on Vercel or `VERCEL_OIDC_TOKEN` from `vercel env pull` locally.
- **Env** keys fall back to shared ones (`DOCUMENT_COMPLIANCE_AI_GATEWAY_API_KEY`, `CLIENT_MANAGER_DATABASE_URL`). `RATE_LIMIT_SALT` also signs MCP tokens, so rotating it revokes them. A request carrying `E2E_BYPASS_TOKEN` passes the gates and lets e2e stub the model.
- **Corpora** have train, validation and test splits. Tune on train and validation only.

## Demo notes

Before you edit a demo (its `src/features/<name>/`, `src/app/demos/<path>/`, `src/app/api/<name>/`, fixtures or e2e spec), read its file:

| Demo | Route | Notes |
| --- | --- | --- |
| Document compliance | `/demos/document-compliance` | `docs/demos/document-compliance.md` |
| Ledger (the cat mascot) | `/demos/ledger`, `/ask/*` | `docs/demos/ledger.md` |
| Casework | `/demos/casework` | `docs/demos/casework.md` |
| Client Manager | `/demos/client-manager` | `docs/demos/client-manager.md` |
| Handover (process transfer) | `/demos/process-transfer` | `docs/demos/process-transfer.md` |
| Harness | `/demos/harness` | `docs/demos/harness.md` |
| Bank (Tidewater Bank) | `/demos/bank` | `docs/demos/bank.md` |
| Sieve (name extraction) | `/demos/name-extraction` | `docs/demos/name-extraction.md` |
| Operator | `/demos/operator` | `docs/demos/operator.md` |
| Loupe | `/demos/loupe` | `docs/demos/loupe.md` |
| Switchboard | `/demos/switchboard` | `docs/demos/switchboard.md` |
| Canvas | `/demos/canvas` | `docs/demos/canvas.md` |
| Vellum | `/demos/vellum` | `docs/demos/vellum.md` |
| Prism | `/demos/prism` | `docs/demos/prism.md` |
| Helio | `/demos/helio` | `docs/demos/helio.md` |
| Floorwalk | `/demos/floorwalk` | `docs/demos/floorwalk.md` |

A new demo gets its own `docs/demos/<name>.md` (start each with the paths it covers) and a row here, and keeps this file to what applies everywhere. Landing page, catalog and About: `docs/engineering/landing.md`.

## Site-wide

- **Hosting.** Vercel Functions run in `syd1` (`regions` in `vercel.json`), beside the Supabase project (ap-southeast-2). A demo request makes several database round trips, so move the two together or not at all.
- **Analytics.** Vercel Web Analytics and Speed Insights load in `src/app/layout.tsx` and collect only on Vercel deployments (turn both on in the Vercel project's Analytics and Speed Insights tabs). Every pageview carries the flag `audience` (`host`, `guest` or `visitor`) from the `labs_profile` hint cookie (`features/access/components/site-analytics.tsx`); filter by it under Flags in the Analytics dashboard; it groups traffic and decides nothing. Sign-ins are custom events from `features/access/server/analytics.ts` (`Host signed in`, `Guest code redeemed`). Never put an email, a name or a Guest pass label in an event.

## Editing this file

Add new sections above the `BEGIN:nextjs-agent-rules` marker: `next dev` rewrites everything between the markers. Keep demo-specific rules in `docs/demos/`, not here.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
