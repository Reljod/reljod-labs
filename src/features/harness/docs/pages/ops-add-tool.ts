import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ops-add-tool",
  section: "operations",
  title: "Add an MCP tool",
  summary:
    "A new capability is a new tool on the server, never a chat-only tool.",
  body: [
    md`
Read [How Claude compatibility works](#doc:claude-how) first. Every capability of the Agent is a tool on the Harness MCP server, so that the chat and Claude can never drift apart.

## Steps

1. **Add an entry** to §STATIC_MCP_TOOLS§ in §domain/mcp-tools.ts§:
   - §name§ in snake case;
   - §title§;
   - §description§: written for a model. Say what it does and when to use it. For a tool that cannot be finished without a person, say so;
   - §permission§: the Action a Staff member's Role must allow, or §null§ when any Staff member may;
   - §group§: one of the groups in the reference;
   - §readOnly§: true when it changes nothing.
2. **Handle it** in the server's registration, in §server/mcp.ts§. The handler:
   - checks the Role again (do not trust the list);
   - takes any limit that applies, in the server function;
   - scopes everything to the Owner;
   - records Audit events with an action from the fixed list;
   - returns text a model can use, with a link where there is somewhere to go.
3. **Use it from chat** with no extra work. The chat calls the same server.
4. **Update the Skill** that tells the Agent when to use it.
5. **Test** that a Role without the permission is refused.

## Rules for new tools

- No tool gives an Approval or settles a Conflict.
- A tool that writes needs a Role that may write, and an Audit event.
- A tool that costs money is limited at the entry point.
- A tool never returns a secret.

## What you get for free

The tool shows in [MCP tool reference](#doc:claude-tools), generated from the registry, with the Role it needs.
`,
  ],
};
