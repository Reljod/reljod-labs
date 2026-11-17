import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "approvals",
  section: "concepts",
  title: "Approvals and four-eyes",
  summary: "The point where a Run waits for a person, and who may give it.",
  body: [
    md`
An **Approval** is the point where a Run waits for a person. The Run shows the Draft and its Findings. The person approves it, or returns it.

## Two risks

- **Low risk**: a letter, a request for missing documents. Any Staff member may give it.
- **High risk**: a payment instruction, a rejection, a report to the regulator. It needs an **admin who did not start the Run**. This is the four-eyes rule.

The Step that asks for an Approval says which risk it is. The server decides who may answer with one function, §approvalRefusal§, and a refused Approval comes back with a sentence that says why:

- "Your Role may not give Approvals."
- "A high-risk Approval needs an admin."
- "A high-risk Approval needs an admin who did not start the Run."

## What happens next

- **Approve**: the Run continues and ends §completed§.
- **Return**: the Run ends §returned§. A return can carry a note.

Either way, the decision is an Audit event with the Staff member and the note.

## The Agent cannot approve

No tool on the MCP server gives an Approval. The Agent in the built-in chat cannot, and neither can Claude. Both can only report that a Run is waiting and link to it. Giving an Approval is something a person does in the app, so neither the Agent nor an outside Claude can approve its own work.

## Four-eyes in a demo

Because anyone can switch Staff in their own Workspace, you can start a Run as an officer and approve it as the manager. That is how the demo shows the rule. In a real deployment, Staff would be separate people. See [Workspace, Staff and Roles](#doc:workspace-staff-roles).

## Under the hood

A Run waits at an Approval on a durable hook, so it can wait for hours without holding a server. See [Durable Runs on the Workflow SDK](#doc:arch-durable-runs).
`,
  ],
};
