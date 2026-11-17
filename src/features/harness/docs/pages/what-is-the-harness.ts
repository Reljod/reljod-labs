import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "what-is-the-harness",
  section: "introduction",
  title: "What the Harness is",
  summary:
    "A chat Agent that is already set up for one bank desk, and reachable from Claude the same way.",
  body: [
    md`
The Harness is a banking agent harness. It puts a chat Agent in front of one desk of a bank and gives that Agent what it needs to do real desk work: **Skills** that say how the desk works, **Pipelines** that do the fixed, checkable parts, a **Knowledge base** it can search and cite, a **Sandbox** where it can run code, and an **Audit trail** that records all of it.

Visitors see it as **Jod: Harness for Bank**. The code, the routes and the database call it §harness§.

## The parts

- **The Agent** is a chat model at work in a Session. It reads Skills, calls tools and reports. It never approves anything and never decides a case.
- **Skills** are instructions in the §SKILL.md§ format that Claude uses. The Agent loads one when a task calls for it. See [Skills](#doc:skills).
- **Pipelines** are fixed pieces of desk work made of Steps. The same input and the same Rule Versions give the same Findings. See [Pipelines, Steps, Runs and Findings](#doc:pipelines-runs).
- **Rules** are the checks a Pipeline makes, written as data an admin can edit. See [Rulebooks and Rules](#doc:rulebooks-rules).
- **The Knowledge base** holds the guides, forms and circulars the Agent may search and cite. See [Knowledge base](#doc:knowledge-base).
- **The Audit trail** records who did what, when, and with which model. See [Audit trail](#doc:audit-trail).
- **The MCP server** is the one way in. The built-in chat and Claude use the same tools. See [How Claude compatibility works](#doc:claude-how).
`,
    { diagram: "architecture" },
    md`
## One server, two front doors

Everything the Agent can do is a tool on one MCP server at §/api/harness/mcp§. The built-in chat calls that server inside the app. Claude.ai, Claude Code and Cowork call it over HTTP after signing in with OAuth. Because both use the same tools, a feature that exists in one exists in the other. There are two chat-only tools: web search, and §load_skill§, which reads a Skill the server also serves.

## What it is not

- It is not a system of record. The records in the demo are fictional and live in a private Workspace.
- It does not give legal, financial or pension advice. Pipelines produce Findings and Drafts for a person to approve.
- It does not let the model decide. Models read documents and write Drafts. Code makes every Finding.

## Where to go next

- To try it now, read [Quickstart](#doc:quickstart).
- To connect Claude, read [Connect Claude in five minutes](#doc:connect-claude-quick).
- To learn the words, read [Workspace, Staff and Roles](#doc:workspace-staff-roles) and the [Glossary](#doc:ref-glossary).
`,
  ],
};
