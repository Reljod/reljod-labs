import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "claude-tools",
  section: "claude",
  title: "MCP tool reference",
  summary:
    "Every tool on the Harness MCP server, grouped, with the Role each needs.",
  body: [
    md`
This list is read from the server's own registry, so it is always the list the server offers. Every call checks the Role of the Staff member the token acts as. A tool the Role does not allow is refused with a message that says which Role it needs.

The tools are grouped by what they work on. A Pipeline is one tool, named §pipeline_<id>§. It starts a Run and returns the Run's id and a link. Follow it with §get_run§.

`,
    { live: "mcp-tools" },
    md`
## Notes

- Tools that read records and lists are open to any Staff member. Tools that change the Workspace need the Role in the last column.
- The Sandbox tools are open to every Role. The Sandbox's own limits hold them in: a microVM with no network, time and size caps, an hourly command cap and the Audit trail. See [Sandbox](#doc:sandbox).
- Search and ingest tools work on the same Knowledge base as the app. Ingest costs model calls and is limited.
- Every call is an Audit event, with its arguments cut to a safe length.
- There is no tool that gives an Approval or settles a Conflict, on purpose. See [What Claude cannot do](#doc:claude-limits).
`,
  ],
};
