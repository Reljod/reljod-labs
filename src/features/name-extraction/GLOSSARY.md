# Name Extraction

Shown to visitors as **Sieve**; the code, routes and database keep the name Name Extraction.

One agent reads a long document (10 to 500 pages) from an AML file and lists every party it names, with every alias and every page it appears on. Recall comes first: a missed name is a missed screening hit, while an extra name costs one look from an analyst.

## Language

**Document**:
The text of one file, one string per page. Either a Corpus Document, generated from a seed, or an Upload.
_Avoid_: File, PDF, input

**Corpus**:
The synthetic Documents (fictional Republic of Meridia, SPECIMEN), each with an Answer key and a Split (train, validation, test). Tune on train and validation only.
_Avoid_: Dataset, fixtures

**Answer key**:
The Names a correct extraction finds in a Corpus Document, with their aliases. Runs on the Corpus are scored against it.

**Analyst**:
The one agent. It plans, writes and runs code, loads Skills, spawns Readers and decides what goes in the Register. There is no fixed pipeline; the Analyst picks its next tool.
_Avoid_: Orchestrator, supervisor, bot

**Reader**:
A sub-agent the Analyst spawns as a tool over one page range. Cheap, parallel, stateless; it returns candidate Names with quotes and never decides.
_Avoid_: Worker, sub-pipeline

**Sweep**:
The deterministic, model-free pass over every page that proposes Candidates (capitalised sequences, honorifics, corporate suffixes, SWIFT fields, signature blocks). It sets the recall floor.

**Candidate**:
A string the Sweep or a Reader thinks may be a Name. The Analyst records it as a Name or dismisses it with a reason.

**Name**:
One distinct party in the Register: canonical form, type (person or organization), aliases, roles, mentions and confidence.
_Avoid_: Entity, hit, match

**Register**:
The Run's list of Names so far. Only `record_names` writes to it.

**Skill**:
A playbook the Analyst loads on demand with `load_skill`, such as alias resolution or the recall audit. Only its one-line description is in context until loaded.

**Sandbox**:
A Vercel Sandbox microVM, no network, with the Document's pages on disk, where the Analyst runs code it wrote.

**Done gate**:
What the harness checks before `finish` may end a Run: every page read by a Reader or `read_pages`, and every Candidate recorded or dismissed. The Analyst decides how to work; the gate decides when it may stop.

**Rulebook**:
The editable rules of extraction (entity types, thresholds, exclusions, plain-language instructions). Versioned per Owner; every Run records the version it ran under.

**Run**:
One extraction of one Document: its events (the Audit trail), its Register, its cost and, on a Corpus Document, its Score.

**Audit trail**:
The Run's events, append-only and ordered: every model call with its model and cost, every tool call with input and output, every Skill loaded, every piece of code run, the Rulebook version.
