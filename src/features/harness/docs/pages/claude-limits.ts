import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "claude-limits",
  section: "claude",
  title: "What Claude cannot do",
  summary:
    "Claude cannot give an Approval or settle a Conflict, and why that is by design.",
  body: [
    md`
## It cannot give an Approval

No MCP tool gives an Approval. Claude can start a Run and read it. When the Run reaches an Approval, Claude can tell you it is waiting and give you the link. You open the Run in the app and decide.

Why: an Approval is the point where a person takes responsibility. If the same Claude that started the Run could approve it, the four-eyes rule would mean nothing. Claude is told this in the tool descriptions: "a pending Approval must be decided by a person in the app: say so and give the link, never claim it is approved."

## It cannot settle a Conflict

Claude can list Conflicts. Settling one needs an admin in the Knowledge tab. A new Passage replaces an old one only when a person says so.

## It cannot change Roles

A token acts as the Staff member chosen at sign-in. Claude cannot switch Staff, edit another person's permissions or read a Role it does not have.

## It cannot go beyond its Role

A user's token cannot edit Skills or Rules, use the Sandbox, remove a Source or read the whole Workspace's Audit trail. The server checks on every call, not only at sign-in.

## It cannot see other Workspaces

A token names one Owner. Everything is scoped to that Owner in the server function.

## It cannot hide what it did

Every call is an Audit event. An admin can read what Claude did, as which Staff member, and with what arguments.

## What it can do

Start Pipelines, read Runs, search the Knowledge base, add and file Sources, read records, read Skills and Rules, read the Audit trail the Role allows, and use the Sandbox if the Role is admin. See [MCP tool reference](#doc:claude-tools).
`,
  ],
};
