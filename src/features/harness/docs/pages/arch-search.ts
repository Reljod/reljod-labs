import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-search",
  section: "architecture",
  title: "Hybrid search and the Conflict check",
  summary:
    "Reciprocal rank fusion of a meaning search and a word search, and how a new Passage is checked against old ones.",
  body: [
    md`
## Why two searches

Vector search finds paraphrase and misses exact terms such as a form number or a section. Full-text search finds exact terms and misses paraphrase. §harness.search_passages§ runs both and fuses them (ADR 0016).

## The function, in outline

§§§sql
-- live: this Owner's Passages, in Sources that are 'ready', not superseded
-- semantic: the 30 nearest by cosine distance to the query embedding
-- lexical: the 30 best full-text matches (query terms joined with OR, prefix match)
-- fused:
--   score = coalesce(1.0 / (60 + semantic.rank), 0)
--         + coalesce(1.0 / (60 + lexical.rank), 0)
-- order by score desc, take at most 25
§§§

The constant 60 is the usual one for reciprocal rank fusion. A Passage that both searches rank high scores highest. A Passage only one search found still counts.

The function returns, for each hit, the Passage, its Source's title, kind and date, the heading, the fused score, the cosine similarity if the meaning search found it, the full-text rank if the word search found it, and whether a Conflict is open on it.

## What is left out

- Passages that a Resolution superseded.
- Passages of Sources that are not §ready§ yet.
- Passages of other Owners. Both the Passage and its Source are matched to the Owner.

## Spreadsheets and CSV

A sheet becomes groups of rows that keep their header, so a retrieved number comes with its column names.

## The embedding

§openai/text-embedding-3-small§, cut to 768 dimensions, through the AI Gateway. The column is §vector(768)§ with an HNSW index. If the embedding is missing, the word search alone still answers.

## The Conflict check

On ingest, each new Passage is searched against the existing ones. Close matches are given to a model (the Steps model) with one question: do these state different values for the same fact? A yes creates a Conflict with both Passages, a summary, a proposed Resolution and the model's reasoning. The check is capped per Source, so a large upload cannot run up a bill. See [Limits](#doc:ref-limits).
`,
    { diagram: "ingest" },
    md`
## Settling

An admin decides. The three Resolutions are in [Conflicts and Resolutions](#doc:conflicts). A superseded Passage gets §superseded_by§ and §superseded_at§, and drops out of search. Nothing is deleted.

## A consequence worth knowing

Until a Conflict is settled, both Passages are retrievable. The answer must say a Conflict is open. That is a rule for the Agent in its Skill, not something the database can enforce, so a person should look where it matters.
`,
  ],
};
