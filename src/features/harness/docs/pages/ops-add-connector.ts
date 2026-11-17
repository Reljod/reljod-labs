import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ops-add-connector",
  section: "operations",
  title: "Add a Connector",
  summary:
    "Mail and chat as future sources of the Knowledge base, and how any other MCP server could join.",
  body: [
    md`
A **Connector** is an MCP server the Agent can call. The Harness MCP server is the built-in one. Web search is a second.

## What is possible today

Only those two. Adding another Connector to the chat means giving the Agent another MCP server in the chat route, and recording its tool calls as Audit events like the others.

## Mail and chat as sources

The planned use is to bring mail and chat into the **Knowledge base** as Sources. A Connector would write a Source for each mail message or chat conversation. Nothing else changes:

- Passages, hybrid search and the Conflict check work on any Source.
- A Source from mail carries the date of the message as its document date, so a newer message can supersede an older one through a Conflict that a person settles.

## What a new Connector must do

1. **Authenticate** with credentials kept on the server, never in the browser, and never in an Audit event.
2. **Scope to the Owner.** Everything it writes carries the Owner.
3. **Write Sources, not Passages.** Let the ingest path split and embed.
4. **Respect limits.** Count its work against §LIMITS§, and add a limit for it.
5. **Be recorded.** Add Audit actions for it to the list in §domain/audit.ts§ first.
6. **Say what it cannot do.** Reading mail is not permission to send it.

## What a Connector must not do

It must not give the Agent a way to approve, send or move money. Those stay with people. A Connector that sends mail would be a new kind of tool with its own Approval, and would need its own decision record.

See the [Roadmap](#doc:ops-roadmap).
`,
  ],
};
