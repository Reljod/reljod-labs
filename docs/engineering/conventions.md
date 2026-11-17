# Engineering conventions

Lessons from review that apply across features. One short section each.

## Cap paid work at every entry point, not only the first

Demos that call a paid model guard the work with limits (documents per run, runs per hour, spend per session). Enforce a limit wherever user input can add that work, not only where the work starts. A run that resumes with an answer, a retry or a follow-up message can add Documents or calls too. In Casework, `startRun` capped a run at 12 Documents, but `answerQuestion` let an answer add any number, and each one is sorted and read by the model.

- Put the number in one place (`LIMITS` in `server/runs.ts`) and apply it in the server function, not only in a zod schema or the UI.
- When you add a path that feeds work into an existing run, check it against the same limits as the path that started it.
- Reads count too. A search that embeds its query calls a paid model on every request: the Harness first shipped `searchKnowledge` with no cap on either the route or the MCP tool. Where refusing would break a chat turn, fall back to the unpaid path (words alone) once the cap is reached.

## Make the escape hatch work when the thing it escapes is broken

A stop, cancel or cleanup path exists for when something went wrong, so it must not depend on the broken part. Treat calls to the external system (workflow cancel, stream close, provider abort) as best effort, and always write the local state change. In Casework, `stopRun` awaited `workflow.cancel()` before marking the Run stopped. Cancel throws on a workflow that already ended, which is exactly the Run that needed stopping, so the row stayed `running` and the one-active-run gate blocked the desk for 45 minutes.

- Wrap the external call in try/catch and keep going to the database update.
- When you add a gate that refuses new work while old work is "active", make sure the way to clear it cannot fail on the cases that make it stale.

## Keep your text out of generated blocks

A tool that writes a block between markers owns everything between them and rewrites it. `next dev` replaces the whole `<!-- BEGIN:nextjs-agent-rules -->` … `<!-- END:nextjs-agent-rules -->` block of `AGENTS.md`, so a section added inside it disappears the next time someone runs the dev server. The Access section first landed there.

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
