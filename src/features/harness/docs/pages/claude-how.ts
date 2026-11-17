import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "claude-how",
  section: "claude",
  title: "How Claude compatibility works",
  summary:
    "One MCP server for the built-in chat and for Claude, and Skills in the same SKILL.md format.",
  body: [
    md`
The Harness is built to be used from Claude and also by someone who never opens Claude. Two tool surfaces (chat-only tools and MCP tools) would drift apart, and the claim of Claude compatibility would stop being true the first time a feature landed on one side only. So there is one surface.

## One MCP server

Everything the Agent can do is a tool on the Harness MCP server at §/api/harness/mcp§. That covers each Pipeline, Run status, Knowledge base search and ingest, record lookups, the Audit trail, Skills and the Sandbox.

- The **built-in chat** calls that server inside the app, with a short-lived token.
- **Claude** calls it over HTTP after signing in with OAuth.

The only chat-local tools are web search and §load_skill§. A new capability is a new MCP tool, never a chat-only tool. See [MCP tool reference](#doc:claude-tools).

## Skills as SKILL.md

Skills are §SKILL.md§ documents: a name, a description and a body. The built-in chat lists names and descriptions and loads a body on demand, as Claude does. The Plugin carries the same files, so Claude gets the Skills you edited, not a stale copy. See [Install the Claude Plugin](#doc:claude-plugin).

## Who Claude acts as

An MCP token names an Owner and a Staff member. The server checks that Staff member's Role on every call, exactly as it does for the app. The Staff member is fixed when the token is made: on the consent page when Claude signs in, or the Session's Staff member for the built-in chat. Changing Staff in the app does not change a token already issued.

## What stays with people

No tool gives an Approval or settles a Conflict. See [What Claude cannot do](#doc:claude-limits).

## What Claude sees

Claude sees the tools its Role allows and the Workspace it signed in to. Everything it does is in the Audit trail: connecting, each tool call and each Run it starts. See [Audit trail](#doc:audit-trail).

## Where to go

- To connect: [Connect Claude](#doc:claude-connect).
- To see what happens at sign-in: [OAuth sign-in step by step](#doc:claude-oauth).
- For the design reasons: [Decisions](#doc:ref-decisions), ADR 0013.
`,
  ],
};
