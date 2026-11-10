# Client Manager

A wealth manager's book of clients, each with a self-correcting knowledge graph you can ask questions of.

## Language

**Client**:
A person the wealth manager serves. Every Client is the Root of their own Client graph.
_Avoid_: Customer, user, contact

**Catalog**:
The grid of Clients: the visitor's own, then the Sample book. Each card shows the Portrait, Persona and a miniature of the graph.
_Avoid_: List, dashboard, directory

**Sample**:
A fictional Client seeded for every visitor to open and ask about. Read-only: no additions.

**Intake**:
How a Client is added: a name, free text about them, files (PDF, images, xlsx, csv, docx, txt) and optionally a photo. Starts the first Build.
_Avoid_: Form, onboarding, upload

**Source**:
One piece of an Intake or addition that facts come from: the note, or one file. Every Node and Edge keeps Evidence pointing at its Sources.
_Avoid_: Document, attachment, input

**Client graph**:
The Nodes and Edges about one Client, stored in Postgres and walked with pgRouting.
_Avoid_: Knowledge base, profile, mind map

**Node**:
One thing worth remembering: a person, company, account, holding, property, goal, trait, event, concern. Addressed by its **Key** (`type:slug`, the Client is `client`).
_Avoid_: Entity, vertex, fact (except as a Node type)

**Edge**:
A relation between two Nodes, as an UPPER_SNAKE verb read from → to (`MARRIED_TO`, `HOLDS`) and the same in plain words.
_Avoid_: Link, relationship (in code)

**Category tree**:
Where Nodes are filed: eight **Branches** (Profile, Family & network, Career & business, Wealth, Goals & plans, Personality, Risk & compliance, Life events), each with fixed leaf Categories (`wealth.accounts`). The Graph view lays every Branch and leaf out in a fixed slot so the graph never piles up; opening one zooms in.
_Avoid_: Tags, folders, clusters

**Evidence**:
The words in a Source a Node or Edge stands on. Check uses it to catch unsupported facts.
_Avoid_: Citation (that is the chat's), proof

**Build**:
One run of the pipeline that turns Sources into graph: Gather, Extract, then review rounds of Check, Critique and Repair, then Commit, Embed and Persona. An Intake starts one; so does each **addition**.
_Avoid_: Job, run, ingestion

**Draft graph**:
The graph a Build works on before Commit, addressed by Keys only.

**Check**:
Code's own review of the Draft graph: dangling Edges, orphans, quotes not in their Source, attribute conflicts, low confidence. Fixes what it safely can.

**Critic**:
A second model, different from the extractor, that reviews the Draft graph against the Sources and answers with Repairs.
_Avoid_: Judge, validator, reviewer

**Repair**:
One structured change to the Draft graph (remove, merge, move, update, settle a conflict, add or remove an Edge), with a one-line reason. Applied by code, recorded, and replayed by the browser.
_Avoid_: Fix, patch, edit

**Persona**:
What the graph says about how to work with the Client: archetype, headline, traits, communication, risk appetite and suggested questions. Inferred after Commit.

**Portrait**:
The Client's picture: uploaded, or painted from the Persona in the house style.
_Avoid_: Avatar, photo (unless uploaded)

**Navigator**:
The chat model that answers questions about a Client by walking the graph with tools (search, expand, connect, browse a Category, read), and records new facts as an addition.
_Avoid_: Assistant, bot, agent

**Traversal**:
The walk the Navigator made for one answer: each tool call, the SQL it ran and the Nodes and Edges it touched. The Graph view lights it up live and can replay it.
_Avoid_: Trace (in UI copy), path (that is one kind of step)
