# Casework

A specialist agent at the pension and onboarding desk of a (fictional) Cayman Islands bank and trust company. It reads a request, runs review work as durable Pipelines of reusable Jobs, and asks a person whenever something it needs is missing.

## Language

### The desk

**Specialist**:
The chat agent. It reads what the person says and drops, and calls Jobs and Pipelines as tools on the Casework MCP server. It never decides a case; Jobs do.
_Avoid_: Bot, assistant, copilot

**Desk**:
One visitor's workspace: their chat with the Specialist, their uploads, their Runs and their Spend. Kept as a session.
_Avoid_: Workspace, account

**Cabinet**:
The file system of Documents the person can drag into the chat: Case files of synthetic Documents, plus the Desk's own uploads.
_Avoid_: Inventory, library, drive

**Case file**:
A folder of synthetic Documents for one matter (one member's withdrawal, one employer, one structure, one alert), labelled with what a correct review finds and assigned to a Split.
_Avoid_: Pack, bundle, scenario

**Document**:
One file in the Cabinet: a PDF, a scan, a phone photo or a CSV.
_Avoid_: Upload, attachment, file

**Kind**:
What a Document is, such as a withdrawal request or a register of members. Sorting decides it; the Kind decides which fields Reading extracts.
_Avoid_: Type, class, category

### Work

**Job**:
One reusable unit of review work with declared needs, such as Sort, Read, Screen or Reconcile. Runs alone (with the Jobs it depends on) or inside a Pipeline, and is one tool on the MCP server.
_Avoid_: Task, step, action

**Pipeline**:
An ordered list of Jobs for one kind of review: pension withdrawal, employer onboarding and arrears, structure file review, screening hit review.
_Avoid_: Flow, workflow, chain

**Run**:
One execution of a Pipeline or of hand-picked Jobs over chosen Documents, as one durable workflow run that streams its events.
_Avoid_: Execution, session, job run

**Need**:
What a Job must have before it can run: a Document of one of some Kinds. An unmet Need becomes a Question.
_Avoid_: Requirement, input, prerequisite

**Question**:
A Run pausing to ask the person for something: a missing Document, an explanation, or which Pipeline to run. Answered with Documents, a choice, a few words, or "go on without it", which records a Gap.
_Avoid_: Prompt, interrupt, request

**Gap**:
A Need the person told the Run to go on without. Any Gap makes the Recommendation "request information" unless a blocking Check already declines.
_Avoid_: Missing item, exception

### Outcomes

**Check**:
One rule applied to what was read, such as "Within the CI$50,000 cap": pass, fail or review, with the values it compared and where they came from.
_Avoid_: Finding, test, rule

**Hit**:
A screening match between a name in the case and a watchlist entry, disposed of as a false positive (with a discount reason), a true match or inconclusive.
_Avoid_: Alert, match result

**Decision file**:
The Run's last word: a Recommendation (approve, refer, decline, request information), a headline, a short summary and next steps, over every Check.
_Avoid_: Report, verdict, outcome

**Spend**:
What every model call cost, in USD as charged by the gateway, by purpose and model.
_Avoid_: Usage, billing

**Split**:
Which evaluation set a Case file belongs to: train, validation or test, 60:20:20 by Document per scenario. Rules are tuned on train and validation; test is held out.
_Avoid_: Fold, partition
