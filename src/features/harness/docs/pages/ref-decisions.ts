import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ref-decisions",
  section: "reference",
  title: "Decisions",
  summary:
    "The architecture decision records behind the Harness, with what each one costs you.",
  body: [
    md`
The records are in §docs/adr/§. Each states the problem, the choice and the consequences. Here is each in short. Read the record before you change what it decides.

## ADR 0013: One MCP server for the chat and for Claude

**Decision.** Everything the Agent can do is a tool on the Harness MCP server. The built-in chat calls it in process. Outside clients sign in with OAuth. The only chat-local tools are web search and §load_skill§. Skills are §SKILL.md§ documents, and the Plugin is built from the Workspace's current Versions. No tool gives an Approval.

**Why.** Two tool surfaces would drift, and "fully Claude compatible" would stop being true.

**Consequences.**
- A new capability is a new MCP tool, never a chat-only tool.
- The Staff member is fixed when a token is made. Switching Staff in the app does not change a token already issued to Claude.
- The OAuth endpoints are the Harness's own, so grants never cross with the Client Manager's.

## ADR 0014: Staff and Roles live inside each Owner's Workspace

**Decision.** Each Workspace is seeded with named Staff: two users and one admin. The visitor picks who they are. §can(staff, action)§ is the one place Roles are decided. High-risk Approvals need an admin who did not start the Run.

**Why.** With one identity per Workspace there is nobody to separate and the "who" column would hold one name. Making the Host the only admin would hide RBAC from every Guest.

**Consequences.**
- RBAC separates duties inside a Workspace. It is not a boundary between visitors. Access and the Owner are.
- A Role cannot protect a risky feature from a Guest. That is why the Sandbox is open to every Role and held in by its own limits (ADR 0022).
- Staff are rows, not Auth users, so the anonymous-user clean-up is untouched.

## ADR 0015: Rules are data an admin edits; the checks that use them are code

**Decision.** A Rule is a sentence with typed Parameters, a switch, an Outcome, a citation and an effective date. Defaults ship in code and an edit saves a Version. A Run records the Version of every Rule it applied. A Rulebook is also a Skill. Models only read and draft. They never return a Finding.

**Consequences.**
- A new kind of check is a code change. A new value is not.
- Parameters are validated on save.
- Calculations are done in code and shown with their inputs.
- The Rules are illustrative and cite their sources. The Docs say this is a demo, not legal advice.

## ADR 0016: The Knowledge base searches by words and meaning, and a person settles Conflicts

**Decision.** Passages have an embedding and a full-text index. §harness.search_passages§ fuses both with reciprocal rank fusion. On ingest, close matches go to a model, and a yes becomes a Conflict that an admin settles. A superseded Passage is kept and left out of search.

**Consequences.**
- Until a Conflict is settled, both Passages are retrievable, and an answer that cites either says a Conflict is open.
- Ingest costs model calls, so it is capped per Source and per hour.
- Search and ingest are MCP tools, so Claude uses the same Knowledge base. Later sources arrive as Connectors.

## ADR 0017: The Agent codes in a Sandbox on the VPS (superseded)

**Superseded by ADR 0022.** It ran one Docker container per Session on a VPS, driven by a Runner behind Caddy and a short-lived signed token, and only an admin's Session could use it. The Runner, its token and the VPS are gone.

## ADR 0018: Every action is an Audit event, and events are only added

**Decision.** §harness.audit_events§ is the one record. Server code writes an event in the same function that does the work. A trigger refuses updates and deletes.

**Consequences.**
- The Audit tab reads one table.
- Details never hold a secret or a whole document.
- Events are purged only with the Workspace, through the Owner purge.
- Demo mode's Beats are audited like anything else.

## ADR 0022: The Sandbox runs on Vercel Sandbox

**Decision.** A Session's Sandbox is a Vercel Sandbox microVM named after the Session, with no network, Node.js and Python, found again by name from any function instance. It lives 10 minutes, each command extends it, and a stopped one keeps its files for 24 hours. Every Role may use it. The reading model Steps of the Member request Pipeline get a §run_code§ tool in a Sandbox of their own, removed when the call ends. Auth is the deployment's OIDC token. It supersedes ADR 0017.

**Why.** It keeps Vercel the only compute, as Sieve already does, and removes a machine to install, patch and keep up. A microVM is a stronger boundary than a container on a shared kernel.

**Consequences.**
- Any visitor can run code. The microVM, the missing network, the time and size caps, the hourly command cap per visitor and the Audit trail hold it in, not the Role.
- Every command is audited, and a command whose event cannot be written does not run.
- Code in a Step is a reading aid. It never returns a Finding (ADR 0015).
- Sandbox time is paid by the project, and bounded by the caps.
- Without credentials (locally, no §VERCEL_OIDC_TOKEN§) the tools say "Sandbox unavailable" and the rest works.

## Earlier records that matter here

- **ADR 0011**: saved data belongs to an Owner, and a Guest's data to their Guest pass.
- **ADR 0012**: MCP clients sign in with OAuth, statelessly. The Harness follows the same design with its own endpoints.
- **ADR 0007 (Jobs as MCP tools on durable workflows)** and **ADR 0010**: the pattern ADR 0013 follows.
`,
  ],
};
