import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ref-api",
  section: "reference",
  title: "HTTP API",
  summary:
    "Every route under /api/harness, read from the route table in the code.",
  body: [
    md`
The app's browser client calls these routes and nothing else. The table is built from §ROUTES§ in §domain/api.ts§, the contract the routes are written to. A path segment in brackets, such as §[id]§, is a value.

## Rules for every route

- Every route passes the Access gate and resolves the Staff member first.
- A write also checks the Role with §requirePermission()§.
- Errors are JSON, §{ "error": "<message for a person>" }§, with one of these statuses:

| Status | Meaning |
| --- | --- |
| 400 | The request is wrong. |
| 401 | No Access. |
| 403 | The Staff member's Role may not. |
| 404 | Not found, or not in your Workspace. |
| 409 | The thing is in the wrong state. |
| 429 | A limit. |

## Routes

`,
    { live: "routes" },
    md`
## Streams

Two routes answer a stream of newline-delimited JSON:

- The chat route sends **chat events**. See [Request path of a chat turn](#doc:arch-chat-turn).
- The Run events route sends **Run events**, and takes §?from=<seq>§ to resume. See [Durable Runs on the Workflow SDK](#doc:arch-durable-runs).

## Other addresses

The MCP server and the OAuth routes are in the table above. They check their own bearer instead of the Staff cookie. These addresses are not routes of the API:

| Path | What it is |
| --- | --- |
| §/.well-known/oauth-protected-resource/api/harness/mcp§ | Protected-resource metadata. |
| §/.well-known/oauth-authorization-server/api/harness§ | Authorization-server metadata. |
| §/demos/harness/mcp§ | The Connect page. |
| §/demos/harness/mcp/authorize§ | The consent page. |
`,
  ],
};
