# Keep each Document's model usage and raw answer, and group runs into a Session

Amends ADR 0003. A Pre-screen run used to keep only what a Reviewer needs (Spans, Extracted fields, Findings), so nobody could tell what a run cost, which model and provider actually answered, how long each stage took or what the model returned before code verified it. Each Document row now keeps the model id the gateway resolved, the provider that served it, input, output, reasoning and cached tokens, the price the gateway reported (`providerMetadata.gateway.cost`), how long parsing and reading took and the model's structured answer as returned (`raw_output`). The read step streams the same usage as a `usage` ScanEvent, so the run page shows the cost while the run is live and a replay shows it again.

Runs started from one browser share a Session id, a random UUID in an httpOnly cookie scoped to the demo, stored on `prescreen_runs.session_id`. The demo lists a Session's runs, newest first, with their Findings, model and cost. We chose a cookie over browser storage so the server can list the runs (and their status) without trusting ids sent by the page, and over sign-in because the demo has no accounts.

## Considered Options

- **Look cost up later with `getGenerationInfo()`**: exact, but the gateway records it after the response, so it needs a second call that may lag; the cost on the response is enough for a demo and costs nothing extra.
- **Keep run ids in `localStorage`**: no migration, but any id typed into storage would list someone else's run, and status and cost would still need a server round trip.

## Consequences

- A cost the gateway does not report is stored as null and shown as "-", never estimated.
- `raw_output` holds the model's judgments, so a run saved since this change replays its real judgments; older runs still rebuild suspected tampering from the `no-tampering` Finding.
- A failed read attempt's usage is not kept; only the attempt that produced the stored readings is.
- The Session id groups runs and nothing else: it is not used for rate limits (still the salted IP hash) and runs still expire after 30 days.
- The run page follows whichever Document has output first rather than the display order, and a visitor can pin any Document while the run is live.
