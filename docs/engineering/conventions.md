# Engineering conventions

Lessons from review that apply across features. One short section each.

## Cap paid work at every entry point, not only the first

Demos that call a paid model guard the work with limits (documents per run, runs per hour, spend per session). Enforce a limit wherever user input can add that work, not only where the work starts. A run that resumes with an answer, a retry or a follow-up message can add Documents or calls too. In Casework, `startRun` capped a run at 12 Documents, but `answerQuestion` let an answer add any number, and each one is sorted and read by the model.

- Put the number in one place (`LIMITS` in `server/runs.ts`) and apply it in the server function, not only in a zod schema or the UI.
- When you add a path that feeds work into an existing run, check it against the same limits as the path that started it.

## Make the escape hatch work when the thing it escapes is broken

A stop, cancel or cleanup path exists for when something went wrong, so it must not depend on the broken part. Treat calls to the external system (workflow cancel, stream close, provider abort) as best effort, and always write the local state change. In Casework, `stopRun` awaited `workflow.cancel()` before marking the Run stopped. Cancel throws on a workflow that already ended, which is exactly the Run that needed stopping, so the row stayed `running` and the one-active-run gate blocked the desk for 45 minutes.

- Wrap the external call in try/catch and keep going to the database update.
- When you add a gate that refuses new work while old work is "active", make sure the way to clear it cannot fail on the cases that make it stale.
