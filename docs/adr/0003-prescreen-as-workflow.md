# Run a Pre-screen as a Vercel Workflow that streams its progress

A Pre-screen run used to be one Server Action that parsed, read and evaluated the whole Document pack before returning, so the page could only say "running" for about a minute. It is now a Vercel Workflow (`prescreenWorkflow`): each Document is parsed and read in its own retryable step, in parallel, and a final step evaluates the Rulebook and saves everything. Every step writes ScanEvents (stage started or finished, Spans found, each field as the model finishes writing it, Field checks, Findings) to the workflow run's stream, and the run page reads that stream through a route that resumes from any index. We chose this over keeping the Server Action and pushing progress through Supabase Broadcast or polling a status column, because the workflow's stream is durable and replayable from the start (a reload or a late visitor sees the whole run), each stage retries on its own without rerunning the others, and no single request has to stay inside the 300 s function limit.

## Considered Options

- **Server Action plus Supabase Broadcast**: progress messages are fire-and-forget, so a reload mid-run loses everything sent before it, and the action still has to fit in one function invocation.
- **Server Action plus polling a status column**: only coarse stages, never field-by-field reading, and still one long invocation.

## Consequences

- `prescreen_runs.workflow_run_id` links our run to the workflow run, so our ids stay in URLs and the database while the stream lives with the workflow.
- Judgments are still not stored. A replay rebuilds Field checks from stored Extracted fields, taking suspected tampering from the Spans the `no-tampering` Finding cites.
- Steps retry up to twice each. A retried read restarts that Document's readings on the page; a step that still fails marks the run failed and ends the stream.
- The workflow's stream holds the events while the run is live; once a run completes, the database is the record and the stream is not needed to show it.
