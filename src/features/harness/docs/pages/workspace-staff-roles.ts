import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "workspace-staff-roles",
  section: "concepts",
  title: "Workspace, Staff and Roles",
  summary:
    "Your private copy of the bank, the named people who work in it, and what each Role may do.",
  body: [
    md`
## Workspace

A **Workspace** is one Owner's private copy of the bank: its Staff, Sessions, Skills, Rules, Knowledge base, records, Runs and Audit trail. It is created with seed data the first time the Owner opens the Harness. Nothing in it is visible to another Owner.

An **Owner** is a Host (a Supabase Auth account) or a Guest pass. A Guest's Workspace belongs to their Guest pass, not to their anonymous Auth user, so it survives a new Guest code and an extension. See [Access, Owners and why Staff are not Auth users](#doc:arch-access).

## Staff

**Staff** are named people who work in a Workspace. You choose which Staff member you are signed in as. The server checks every write against that Staff member, and the Audit trail records them.

Every Workspace starts with the same Staff:

`,
    { live: "staff" },
    md`
Staff are fictional. They are rows in your Workspace, not Auth users. A Staff member is not a Member: a Member is a person with a pension account.

## Roles

A **Role** is what a Staff member may do: §user§ or §admin§.

- A **user** works cases: chats, uploads, starts Runs and approves low-risk Approvals.
- An **admin** also edits Skills and Rules, settles Conflicts, approves high-risk Approvals and reads the whole Workspace's Audit trail.

An admin may do everything a user may do.

## The permission matrix

This table is read from the code that decides Roles. A server function that writes checks it, and so does every MCP tool.

`,
    { live: "permissions" },
    md`
## What a Role is not

A Role separates duties **inside** a Workspace. It is not a security boundary between visitors. Anyone in a Workspace can switch to its admin, on purpose, so that every visitor can try both Roles. What keeps visitors apart is Access and the Owner. So "admin only" could not protect a risky feature from a Guest. That is why the Sandbox is open to every Role and held in by its own limits. See [Sandbox](#doc:sandbox).

The Agent has no Role. It can approve nothing.
`,
  ],
};
