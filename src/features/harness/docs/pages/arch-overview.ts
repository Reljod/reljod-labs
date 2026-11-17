import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-overview",
  section: "architecture",
  title: "System overview",
  summary:
    "What runs where, and the one rule that holds it together: everything goes through the MCP server.",
  body: [
    md`
The Harness is a feature of a Next.js app deployed on Vercel. It has four kinds of part.
`,
    { diagram: "architecture" },
    md`
## The app

- **Pages** under §/demos/harness§: one client shell with six tabs and Demo mode. The browser calls the server only through one typed client that mirrors the route table in [HTTP API](#doc:ref-api).
- **Route handlers** under §/api/harness/*§. Each one passes the Access gate and resolves the Staff member first.
- **The MCP server** at §/api/harness/mcp§, which checks its own bearer token.
- **The OAuth endpoints** at §/api/harness/oauth/*§ and the well-known metadata that points at them.

## Durable work

A Run is a workflow on the Workflow SDK. It is durable: it survives restarts and can wait for an Approval for as long as it takes. See [Durable Runs on the Workflow SDK](#doc:arch-durable-runs).

## Data

Supabase Postgres, in the §harness§ schema, reached directly from server code over the transaction pooler. Files go to a private storage bucket named §harness§. See [Data model](#doc:arch-data-model).

## Models

All model calls go through Vercel AI Gateway:

| Use | Default model | Env override |
| --- | --- | --- |
| The Agent in chat | §anthropic/claude-sonnet-5.5§ | §HARNESS_MODEL§ |
| Steps that read or draft, and the Conflict check | §anthropic/claude-haiku-5.5§ | §HARNESS_STEP_MODEL§ |
| Embeddings (768 dimensions) | §openai/text-embedding-3-small§ | §HARNESS_EMBEDDING_MODEL§ |

## The Sandbox

A Runner on a VPS drives Docker containers. The app calls it over HTTPS with a short-lived signed token. See [Sandbox and Runner](#doc:arch-sandbox).

## The rules that hold it together

1. **One way in.** Everything the Agent can do is a tool on the MCP server (ADR 0013).
2. **Two gates.** The proxy turns visitors away before a page runs, and every route handler and server function calls the Access gate itself.
3. **Roles in one place.** §can(staff, action)§ decides, and every write calls it.
4. **Audit in the same function.** The function that does the work records it.
5. **Rules are data, checks are code** (ADR 0015).
6. **Caps at every entry point.** Hourly and concurrency limits are taken in the server function, so the app, the chat and the MCP server share them. See [Limits](#doc:ref-limits).
`,
  ],
};
