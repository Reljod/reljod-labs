import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "app-audit",
  section: "using",
  title: "Audit tab",
  summary:
    "Read the Audit trail, filter it and follow an event to what it was about.",
  body: [
    md`
The [Audit tab](#tab:audit) reads the Audit trail.

## What you see

Each event shows when it happened, who did it (a Staff member, the Agent or the System), what was done, what it was done to, and the Session. Events from the Agent also show the model, the tokens and the cost.

## Scope

- A **user** sees the trails of their own Sessions.
- An **admin** sees the whole Workspace's trail.

## Filtering

Filter by Session, by who did it and by action. The actions are the fixed list in [Audit actions](#doc:ref-audit-actions). Long trails load a page at a time.

## Reading an event

The summary is one line a person can read, such as "Approved the transfer letter". The details hold ids, names, sizes and Rule Versions. They never hold a secret or a whole document.

## What you cannot do

You cannot edit or delete an event. Nobody can. See [Audit design](#doc:arch-audit).
`,
  ],
};
