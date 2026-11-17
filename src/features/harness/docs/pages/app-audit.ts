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

Each event shows when it happened, who did it (a Staff member, the Agent or the System), what was done, what it was done to, and the Session: the first 8 characters of its id, in a colour that is the same for every event of that Session, so the events of one Session read as related. Hover the chip for the Session's title, or press it to open that Session in Chat. The full Session id is in the event's details. Events from the Agent also show the model, the tokens and the cost.

## Scope

The buttons at the top choose which events:

- **This Session**: the Session open in Chat.
- **My Sessions**: the events of the Sessions you opened. For an admin the server does the filtering, so every page of "Load more" holds only those.
- **Workspace**: everything. Only an admin may press it, and an admin starts here. Events that belong to no Session, such as a Rule save or a Conflict settlement, are only here.

A **user** can read only the trails of their own Sessions, whatever they ask for. An **admin** can read the whole Workspace's trail.

## Filtering

Filter by Session (chosen from a list of Sessions by title and short id), by who did it and by action. The actions are the fixed list in [Audit actions](#doc:ref-audit-actions). Long trails load a page at a time. **Pause refresh** stops the tab updating every few seconds, and **Export CSV** saves what is on screen, with the full Session id and its title.

## Reading an event

The summary is one line a person can read, such as "Approved the transfer letter". The details hold ids, names, sizes and Rule Versions. They never hold a secret or a whole document.

## What you cannot do

You cannot edit or delete an event. Nobody can. See [Audit design](#doc:arch-audit).
`,
  ],
};
