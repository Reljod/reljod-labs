# Engineering conventions

Lessons from review that apply across features. One short section each.

## Cap paid work at every entry point, not only the first

Demos that call a paid model guard the work with limits (documents per run, runs per hour, spend per session). Enforce a limit wherever user input can add that work, not only where the work starts. A run that resumes with an answer, a retry or a follow-up message can add Documents or calls too. In Casework, `startRun` capped a run at 12 Documents, but `answerQuestion` let an answer add any number, and each one is sorted and read by the model.

- Put the number in one place (`LIMITS` in `server/runs.ts`) and apply it in the server function, not only in a zod schema or the UI.
- When you add a path that feeds work into an existing run, check it against the same limits as the path that started it.
- Reads count too. A search that embeds its query calls a paid model on every request: the Harness first shipped `searchKnowledge` with no cap on either the route or the MCP tool. Where refusing would break a chat turn, fall back to the unpaid path (words alone) once the cap is reached.

## Take the cap before the first paid step, not the main one

A request that is refused partway through still spent whatever ran before the refusal. In Canvas, `run_query` sent the SQL to the Sandbox to be parsed for the Guard, and only took a Run from the hourly allowance afterwards, in `runGuardedQuery`. A statement the Guard refused never got there, so an MCP client could send refused SQL in a loop: a Sandbox job and a Trail row each time, with no cap.

- Take the rate (and check any per-Question budget) before the first call to a model, a Sandbox or any other metered service in the request, including validation steps such as parsing.
- When a later step also takes the rate, pass along that it was already taken, so one Run counts once.

## Make the escape hatch work when the thing it escapes is broken

A stop, cancel or cleanup path exists for when something went wrong, so it must not depend on the broken part. Treat calls to the external system (workflow cancel, stream close, provider abort) as best effort, and always write the local state change. In Casework, `stopRun` awaited `workflow.cancel()` before marking the Run stopped. Cancel throws on a workflow that already ended, which is exactly the Run that needed stopping, so the row stayed `running` and the one-active-run gate blocked the desk for 45 minutes.

- Wrap the external call in try/catch and keep going to the database update.
- When you add a gate that refuses new work while old work is "active", make sure the way to clear it cannot fail on the cases that make it stale.

## Keep your text out of generated blocks

A tool that writes a block between markers owns everything between them and rewrites it. `next dev` replaces the whole `<!-- BEGIN:nextjs-agent-rules -->` … `<!-- END:nextjs-agent-rules -->` block of `AGENTS.md`, so a section added inside it disappears the next time someone runs the dev server. The Access section first landed there, and the Hosting section (PR #45) did again.

- Add project notes above the `BEGIN:` marker, never between the markers.
- Before editing a file another tool writes to, look for its markers or "generated" header and keep to the parts it leaves alone.

## Storage paths never carry raw browser input

A file name, extension or type sent by the browser is untrusted. Before any of it goes into a Supabase Storage key (or any path), reduce it to a safe token: use `safeExtension` in `src/features/client-manager/domain/file-name.ts` for extensions and `slugify` for stems. In Client Manager, three call sites each built an extension with `name.split(".").pop()`, and only one of them sanitised it. So a name like `a./../x` reached the key of a signed upload URL.

- Use one shared helper; don't re-derive the extension at each call site.
- Keep every key the browser can influence under the owning record's prefix (`clients/<id>/…`).

## Saved data is scoped to the Owner, never to the browser

Each demo first grouped saved data by a cookie of its own (`client_manager_session`, `casework_desks`, `prescreen_session`) or by an id in the URL. A Guest's second device saw nothing, a Host on a new browser lost their book, and an Ask session or Pre-screen run opened for anyone who had its id. Worse, Guest data was tied to things that die (the anonymous Auth user, the browser), so ending or replacing a Guest pass lost it.

- Read the Owner with `requireOwner()` and filter every list and every load by id on `owner`, in the server function. Check ownership of the parent too when a route takes a child id (a run of a desk, a source of a client).
- Key a Guest's data on the Guest pass, so it outlives devices and codes.
- Deleting a person's access is a soft delete with a 30-day purge (`access.purge_deleted_guest_passes`), not a cascade from the Auth user. Register each new owned table in `access.owned_tables` so the purge reaches it.
- Rows from before Owners have `owner` null and are shown to nobody; samples meant for everyone say so explicitly (`is_sample`).

## A write button fires once, and says what happened

The Guest pass page first shipped Extend and New code as bare buttons: a click gave no sign it had worked, so a Host clicked again, and each click wrote again (two extensions, or a second code that silently replaced the one just shown). A button that writes must not be able to send twice, and the person must see the result.

- Disable the button while its write is in flight and show a pending label ("Extending…") with `aria-busy`. Use the pending flag of `useActionState`, `useFormStatus` or `useMutation`; add a synchronous ref guard where the flag is set only after an await or lives in another component. Enter-to-submit and chips go through the same guard.
- Ask to confirm a write that is destructive or hard to undo (delete, revoke, stop, a new code that replaces the old one), in a dialog that names what will happen. `ConfirmDialog` in `src/features/access/components/pass-actions.tsx` is the pattern: a native `<dialog>`, Escape and the backdrop close it except while the write runs.
- An escape hatch is the exception: Casework's Stop (and Esc) is guarded but never asks first, because a confirm would slow down the one control that must always work and it deletes nothing.
- Show the result where the person clicked (what changed, or the error inline). Never fail silently.

## A durable workflow outlives the row that says it ended

A Workflow SDK run keeps going after the app marks its database row `failed` or `stopped`: a sleep or a hook wait resumes later and runs the next steps. In the Harness, a resume that failed marked the Run `failed`, but 24 hours later the workflow woke, read back the `approved` decision and posted Schedules for a Run the screen called failed.

- When a workflow resumes after a wait, check that its row is still active (`setRunStatus` returns whether it moved) before any step that writes records, and treat an ended row as "do not act".
- Or cancel the workflow itself in the same place the row is ended. Either way, never let the row and the workflow disagree about whether work may still happen.

## A workflow's step names are its replay keys

The Workflow SDK identifies a workflow and each step by file path and function name (`step//./src/features/harness/server/run-steps//saveCompute`). A run that is waiting (a 24-hour Approval hook, a sleep) replays by those ids when it wakes, so renaming a `"use workflow"` or `"use step"` function, or moving it to another file, orphans every run in flight on the old deployment. In the Harness, naming steps after Pipeline Steps (`harnessRun` to `memberRequest`, `workStep` to `classify`) changed every id.

- Treat a rename or move of a workflow or step function as a breaking change: say so in the PR and ship it when no run is waiting, or let the stale sweep close the old runs.
- Pick trace-friendly names when you first add a workflow, so you do not have to rename it later.

## A demo reads through GET routes, never through server actions

Next sends a browser's server actions one at a time (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, "Sequential dispatch on the client"). Five demos read their data through actions called from `useEffect`, so every load, page chunk, poll and comparison waited in one line behind the others and behind any write. In Sieve, scrolling a 500-page Document fetched each 12-page chunk only after the rulebook history, the runs list and any Start or Stop in flight. Each action also ran its own access check.

- Read through GET Route Handlers under the demo's `/api/<demo>/` prefix, which must be in the `src/proxy.ts` matcher. Keep server actions for writes.
- Use the three-file shape Harness started and the five read layers (Casework, Sieve, Document compliance, Handover, Client Manager) now share: `domain/api.ts` (`API_ROOT`, `apiPath`, one response type per route), `server/respond.ts` (`json`, `failure`, `NO_STORE`, `SEED`) and `components/api.ts` (`getJson` with an `AbortSignal`, and a typed wrapper per route). Harness has `NO_STORE` but no `SEED` (each Workspace gets its own copy of the seed, so nothing is shared) and reads through a private `get`, so copy `SEED` and `getJson` from one of the five. Components never call `fetch` for a read directly.
- A handler passes the gate first, validates its query with zod and scopes every read to the Owner. `failure()` calls `unstable_rethrow` first, answers a refusal with the gate's `denied()`, and never returns a stack trace or the cause in its body.
- The gate's 401 answer is plain text, not JSON. `getJson` must read the body as text and parse JSON only if it can, or a Guest whose pass just ended sees "Request failed (401)" instead of the reason.

## A demo page arrives with its first view

Every demo first painted an empty shell, hydrated, and only then asked for its data. With the action queue on top, Handover with `?run=` in the address made two requests in a row before anything showed.

- The page's server component reads the first view with `Promise.all`, behind `<Suspense>` (the reads use cookies and `cacheComponents` is on). The Suspense fallback is a skeleton shaped like the screen. The data is passed down as `initial…` props. The client seeds its state from them (React Query: `initialData` plus a `staleTime`) and does not fetch again on mount.
- Data that needs no Owner (corpus cards, samples) goes into the static shell outside Suspense, or is imported. Sieve's cards cost about 92 ms of server time per visit before; now they cost nothing.
- A try/catch around a request read (in that server component or any server helper it calls) calls `unstable_rethrow(error)` from `next/navigation` first. Otherwise it swallows Next's prerender bail-out, `notFound()` or `redirect()`, and `pnpm build` prerenders the page with no data in it. Document compliance's `initialFor` first shipped without it; only `pnpm build` caught it.

## One gate call per request, and independent work starts together

For a Host, `requireOwner()` is a call to the Supabase auth server. Casework's desk load called it twice, once in each helper. Client Manager's client file ran the gate, then the lookup, then seven queries on a 4-connection pool, so it took two database rounds.

- Resolve the Owner once at the entry point (page, handler, action) and pass `owner` down. Never call the gate again inside the helpers of the same request.
- Start independent work in one `Promise.all`: the gate with the row lookup, a rate-limit count with the session load, the signed URL with the model-call query. Return no data unless the gate passed, and never leave a rejected promise unhandled.
- Fold small scalar reads into one query, so that a view's queries fit the pool in one round. Index the columns a view filters by (Client Manager, `20261118130000_client_manager_read_indexes.sql`).

## Cache by who can change the data

- `NO_STORE` (`private, no-store`) for anything an Owner saved or that can still change. `SEED` (`private, max-age=300, stale-while-revalidate=3600`) only for deterministic shared data. Never `public`: every demo route is behind the gate.
- If a response contains a signed URL, it gets `NO_STORE`, even for seed data, because the stale window could hand out an expired link.
- Signed URLs for shared seed files are cached on the server and reused while they have plenty of time left (signed for 2 hours, reused while more than 1 hour remains). The URL then stays the same, so the browser's image cache works. Document compliance re-signed every page image on every load, so the browser downloaded each one again. Files an Owner uploaded are signed per request.
- Data derived from an Owner's settings (Sieve's pre-run preview depends on the current rulebook) is not seed data. Cache it for a short time and drop it when the setting is saved.
- A finished Run that cannot change any more is kept in component state for the visit: bounded (Handover keeps 20), expiring before any signed URL in it does, and cleared by Redo. Reopening it makes no request and replays nothing. Keep it in component state rather than a module-level Map, so it does not outlive the visit or the person. A Run that can still change after it finishes (Document compliance: re-evaluate, review) is not cached.

## Clicks react in the same frame; waits look like what is coming

- Keep the previous view on screen, marked `aria-busy`, while the next one loads. Never blank a list for a refetch, and never let a tab remount throw away what it showed. Handover keeps a tab mounted once it has been visited.
- Start loading on intent: on hover or focus, and in Handover after a pointer rests for 120 ms. Use that read once, only while it is fresh (Handover: 10 s), and discard it after a write. Anything already loaded paints on the first render, not after an effect.
- Start the work and the animation together. Ledger's cat used to finish its 1.16 s run-off before the ask started. Client Manager's Map used to wait for its reveal before fetching. Prefetch the destination as soon as its id is known.
- Heavy client-only code (React Flow, the DOCX/PPTX builders, the Map renderer, rarely visited tabs) loads with `next/dynamic` or `import()`, and is prefetched on hover, on focus or when the browser is idle. Handover's first download went from 111 KB to 87 KB gzipped.
- A loading state is a skeleton in the demo's own style and shaped like the content, with `aria-busy` and an sr-only `aria-live="polite"` status. It reserves the space so nothing shifts when the data lands, and it has an error state, never an endless shimmer. A wait over about a second says what is happening.
- Apply streamed events at most once per animation frame, and memoise finished items so the live one is the only one that re-renders. Do not poll where a stream already exists.

## A read in flight never undoes a write

Moving reads off the action queue lets them overlap with writes. In Handover, a Desk read that started before a Rule save could land after it and put the old Rules back on screen.

- A write discards every read of the same data that is still in flight, then reads again (or applies the write's own answer).
- A newer refresh aborts the older one (`AbortController`), and an answer for a view that is no longer open is dropped.
- A page appended to a list ("Load older") attaches only to the version of the list it was requested for.
