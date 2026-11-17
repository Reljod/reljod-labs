# The Knowledge base searches by words and meaning, and a person settles Conflicts

Staff upload guides, circulars and spreadsheets in chat. Pure vector search misses exact terms (a form number, a section), full-text search misses paraphrase, and a new document can quietly disagree with an old one.

A Source is split into Passages. Each Passage has an embedding (`openai/text-embedding-3-small`, 768 dimensions, as in the Client Manager) and a generated `tsvector`. `harness.search_passages` runs both searches and fuses them with reciprocal rank fusion. Spreadsheets and CSVs become row-group Passages that keep their header, so a number is retrieved with its column names.

On ingest, each new Passage is searched against the existing ones; close matches are given to a model with one question: do these state different values for the same fact? A yes becomes a Conflict with both Passages, a summary and a proposed Resolution. An admin decides: the new one supersedes, both stay with their dates, or the new one is set aside. A superseded Passage is kept, marked, and left out of search. Nothing is superseded without a person.

## Consequences

- Until a Conflict is settled both Passages are retrievable, and an answer that cites either says a Conflict is open.
- Ingest costs model calls, so it is capped per Source (Passages checked) and per hour like other paid work.
- Search and ingest are MCP tools, so Claude uses the same Knowledge base. Later sources (mail, chat) arrive as Connectors that write Sources; nothing in search changes.
