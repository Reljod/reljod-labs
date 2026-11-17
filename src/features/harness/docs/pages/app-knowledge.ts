import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "app-knowledge",
  section: "using",
  title: "Knowledge tab",
  summary: "Sources, Passages, search and Conflicts.",
  body: [
    md`
The [Knowledge tab](#tab:knowledge) is the Workspace's Knowledge base.

## Sources

The list shows each Source with its kind, status, the date the document carries, and how many Passages and open Conflicts it has. Open one to read its Passages. Seed Sources are marked and cannot be removed.

## Adding a Source

Upload a PDF, spreadsheet, CSV or text file. The browser sends the file straight to private storage with a signed address, then the server reads it, splits it into Passages, embeds them and checks them for Conflicts. The Source's status shows its progress. Any Staff member can add a Source. Only an admin can remove one. Size and count are limited: see [Limits](#doc:ref-limits).

## Searching

Type a question or a phrase. Search finds Passages by meaning and by words together. Each hit shows its Source, its heading and its date, and marks a Passage that has an open Conflict. See [Knowledge base](#doc:knowledge-base).

## Conflicts

A Conflict shows both Passages side by side, a summary of the difference and the Agent's proposal. An admin chooses a Resolution:

- the new Passage supersedes the old one;
- both stay, with their dates;
- the new Passage is set aside.

The choice is an Audit event. A superseded Passage is kept, marked, and no longer retrieved. See [Conflicts and Resolutions](#doc:conflicts).
`,
  ],
};
