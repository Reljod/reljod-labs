import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "knowledge-base",
  section: "concepts",
  title: "Knowledge base, Passages and hybrid search",
  summary:
    "The documents the Agent may search and cite, and how search finds them by meaning and by words.",
  body: [
    md`
The **Knowledge base** holds the documents the Agent may search and cite: guides, forms, policies, circulars. Your Workspace starts with seed Sources and grows by upload.

## Source

A **Source** is one document: a PDF, a spreadsheet, a CSV, a text or a web page. A Source has a status (pending, reading, ready, failed), the date the document itself carries, and a count of its Passages and open Conflicts. Seed Sources cannot be removed.

## Passage

A **Passage** is a piece of a Source small enough to retrieve and cite. A spreadsheet or CSV becomes groups of rows that keep their header, so a number is retrieved with its column names.

## Hybrid search

Pure vector search misses exact terms such as a form number or a section. Plain text search misses paraphrase. So search runs both and fuses the results:

1. **By meaning.** Each Passage has an embedding (§openai/text-embedding-3-small§, 768 dimensions).
2. **By words.** Each Passage has a full-text index.
3. **Fusion.** The two ranked lists are combined by reciprocal rank fusion.

Superseded Passages and Sources still being read are left out. Each hit shows its Source, its heading, its document date and whether a Conflict is open on it. The SQL is in [Hybrid search and the Conflict check](#doc:arch-search).

## Citing

The Agent cites the Source and Passage it used. If a hit says a Conflict is open, the Agent must say so in its answer.

## Adding a Source

You can add a Source by uploading it in a [Session](#doc:sessions-agent) or in the [Knowledge tab](#tab:knowledge). The file goes to a private storage bucket, is split into Passages, embedded, and checked for Conflicts. There are limits on size and number. See [Limits](#doc:ref-limits).

Chat attachments are **pending Sources**. The Agent can read one without filing it, file it in the Knowledge base, or hand it to a Pipeline.

## Later sources

Mail and chat are future Connectors that will write Sources. Nothing in search changes when they arrive. See [Roadmap](#doc:ops-roadmap).
`,
  ],
};
