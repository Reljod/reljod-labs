# Engineering conventions

Lessons from review that apply across features. One short section each.

## Cap paid work at every entry point, not only the first

Demos that call a paid model guard the work with limits (documents per run, runs per hour, spend per session). Enforce a limit wherever user input can add that work, not only where the work starts. A run that resumes with an answer, a retry or a follow-up message can add Documents or calls too. In Casework, `startRun` capped a run at 12 Documents, but `answerQuestion` let an answer add any number, and each one is sorted and read by the model.

- Put the number in one place (`LIMITS` in `server/runs.ts`) and apply it in the server function, not only in a zod schema or the UI.
- When you add a path that feeds work into an existing run, check it against the same limits as the path that started it.
