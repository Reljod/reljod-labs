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

The list shows each filed Source with its kind, status, the date the document carries, and how many Passages and open Conflicts it has. Open one to read its Passages. Seed Sources are marked and cannot be removed.

### Attached in a Session, not filed

Above the list, a separate group shows files that were attached in Chat and never filed. They are in the Workspace, so the Agent can read them and a Pipeline can take them as input, but they are not in the Knowledge base: search does not find them and no Conflict check has run. Press **File** on one to read it into Passages and check it against the Sources already there. Any Staff member can file one.

### Preview

An open Source has two views: **Passages** and **Preview**. Preview shows the document raw, in two ways:

- **Original**: the stored file. A PDF is drawn page by page in the page, a CSV or XLSX is a scrollable table with its header row kept in view (one tab per sheet), and Markdown or text is shown as text. A seed Source has no file, so its text is shown. **Open the file in a new tab** uses a signed link that lasts five minutes.
- **Raw text**: exactly the text the Agent reads, in monospace, with its character count and a **Copy text** button.

Preview works for a Source that is attached and not filed too, and the **Preview** button on an attachment or a Source card in Chat opens it. Every Preview is an Audit event (§source.read§).

## Adding a Source

Use **Choose files** (or drop files) in the **Add a Source** panel, or **Add sample** to pick one of the sample documents. Upload a PDF, spreadsheet, CSV, DOCX or text file. The browser sends the file straight to private storage with a signed address, then the server reads it, splits it into Passages, embeds them and checks them for Conflicts. The Source's status shows its progress. Any Staff member can add a Source. Only an admin can remove one. Size and count are limited: see [Limits](#doc:ref-limits).

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
