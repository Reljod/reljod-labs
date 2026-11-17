import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "sessions-agent",
  section: "concepts",
  title: "Sessions and the Agent",
  summary:
    "One conversation with the Agent, what it can use, and what it never does.",
  body: [
    md`
## Session

A **Session** is one conversation between a Staff member and the Agent, with its uploads, its Runs and its own Audit trail. Several Sessions can be at work at once, so you can start a second case while the first Run waits for an Approval.

A Session belongs to the Staff member who opened it. A user sees their own Sessions. An admin sees the whole Workspace's.

## The Agent

The **Agent** is the chat model at work in a Session. By default it is §anthropic/claude-sonnet-5.5§, called through Vercel AI Gateway. An environment variable can change the model. See [Environment variables](#doc:ref-env).

The Agent:

- reads **Skills**: it sees each Skill's name and description, and loads the body when a task calls for it;
- calls **tools** on the Harness MCP server: Pipelines, Run status, Knowledge base search, record lookups, the Audit trail, Skills and the Sandbox;
- uses **web search**, the second Connector, when the Knowledge base cannot answer;
- reads **attachments** you add to a message, files them in the Knowledge base, or hands them to a Pipeline;
- reports what it did, and links to the Runs it started.

The Agent does not:

- give an Approval, or settle a Conflict;
- decide a case. Pipelines and people do;
- call anything that is not a tool on the MCP server, apart from web search and §load_skill§.

## Limits on a turn

A turn is capped at a number of model steps, tool calls included, and a message at a number of characters. A visitor can send a limited number of messages an hour. The numbers are in [Limits](#doc:ref-limits).

## Connectors

A **Connector** is an MCP server the Agent can call. The Harness MCP server is the built-in one. Web search is a second. Mail and chat sources come later as more Connectors. See [Add a Connector](#doc:ops-add-connector).
`,
  ],
};
