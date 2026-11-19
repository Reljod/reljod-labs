# Loupe's Examiner works through the Loupe MCP server, and its state lives in the Examination

Sieve's Analyst runs its tools as plain functions inside workflow steps and keeps its ledger in the workflow's own state; its MCP server is a second, smaller surface for outside clients (start a Run, read it). Two surfaces drift, and a tool only the built-in agent has is a capability Claude does not have. The Harness solved that for chat (ADR 0013): everything is an MCP tool, called in process.

Loupe does the same for a durable agent loop.

- **One server, `/api/loupe/mcp`.** The Examiner's eight tools and the tools an outside client needs (`list_samples`, `create_upload`, `start_examination`, `get_examination`, `get_evidence`, `list_rules`, `edit_rule`, `reevaluate`, `read_trail`, `get_calibration`, `stop_examination`) are registered on it and are the same server functions the app's actions call (`server/tools.ts`, `examinations.ts`, `rulebooks.ts`, `uploads.ts`). Owner scoping, caps, Rules, the Trail and the Audit trail are in those functions, so they hold whoever calls.
- **The in-app Examiner is an MCP client.** Each tool call the model returns is a workflow step that calls the server in process (`createMCPClient` with a `fetch` that invokes the handler) with a ten-minute token bound to that one Examination. The model's tool definitions omit `examinationId`; the step fills it in, and the server refuses any other.
- **An outside client can be the Examiner.** `start_examination` with `mode: "client"` prepares the Document, runs the Sweep and leaves the Examiner's tools to the caller, under the same caps and the same Done gate; its `finish` ends the Examination. An Examination with its own Examiner refuses those tools to a client, which may still `run_check` on it.
- **State is in the row, not in the workflow.** Measurements, Hypotheses, reviews, pages looked at and counters are one JSON column changed only by the tools, under a row lock (`mutateState`), so the workflow and a client cannot lose each other's writes. The workflow carries the conversation and nothing else. Images never travel through it: a `look` stores its image in the Examination's folder and leaves a marker; the turn step loads the last few before the model call.
- **Tokens.** An Owner's token (Connect a client) is signed with `RATE_LIMIT_SALT`, not stored, and checked against the Owner's Access on every call: a Guest's dies with the Guest pass, a Host's when the Host leaves the list. Rotating the salt revokes all of them.

## Consequences

- Anything the page can do, a client can do, and the e2e suite proves it by running the same journey through the endpoint.
- A tool call costs an in-process MCP round trip (a few milliseconds and a token signature). It buys one code path.
- Code in the Sandbox is written to the Trail before it runs and refused if that write fails (ADR 0018, ADR 0021), for the Examiner and a client alike.
- Workflow and step function names are replay keys (conventions.md): `loupeExamination` and the steps in `server/steps.ts` must not be renamed or moved while an Examination is running.
- There is no OAuth for Loupe's server yet: a client pastes a token. The Harness's flow (ADR 0012) is the model if that is wanted.
