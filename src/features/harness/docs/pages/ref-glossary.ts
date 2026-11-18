import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "ref-glossary",
  section: "reference",
  title: "Glossary",
  summary: "Every term of the Harness, and the words not to use for it.",
  body: [
    md`
This glossary matches §src/features/harness/GLOSSARY.md§. It is the language of the Harness: use these words, and not the ones listed under each term.

## People

### Workspace
One Owner's private copy of the bank: its Staff, Sessions, Skills, Rules, Knowledge base, records, Runs and Audit trail. Created with seed data the first time the Owner opens the Harness. Nothing in it is visible to another Owner.

Words not to use for it: Tenant, org, account, Desk (Casework's word)

### Staff
A named person who works in a Workspace, such as a pensions officer. The visitor chooses which Staff member they are signed in as; the server checks every write against that Staff member and the Audit trail records them. Staff are not Auth users: Access still comes from the Host or Guest pass (see the Access glossary).

Words not to use for it: User account, persona, profile, member (a Member is a pension plan member)

### Role
What a Staff member may do: §user§ or §admin§. A user works cases: chats, uploads, starts Runs, approves low-risk Approvals. An admin also edits Skills and Rules, settles Conflicts, approves high-risk Approvals and reads the whole Workspace's Audit trail. Every Role may use the Sandbox.

Words not to use for it: Permission level, group

### Agent
The chat model at work in a Session. It reads Skills, calls tools on the Harness MCP server and reports. It never approves anything and never decides a case; Pipelines and people do.

Words not to use for it: Bot, assistant, copilot, Specialist (Casework's word)

## Conversation

### Session
One conversation between a Staff member and the Agent, with its uploads, its Runs and its own Audit trail. Several Sessions can be at work at once.

Words not to use for it: Thread (Client Manager's word), chat, Desk

### Connector
An MCP server the Agent can call. The Harness MCP server is the built-in one; web search is a second. Mail and chat sources come later as more Connectors.

Words not to use for it: Integration, plugin (a Plugin is the Claude download)

### Plugin
The downloadable Claude plugin built from the Workspace's current Skills plus the Harness MCP server's address. Installing it gives Claude the same Skills and tools as the built-in chat.

Words not to use for it: Extension, package

## Skills and rules

### Skill
Instructions the Agent loads when a task calls for them: a name, a one-line description that says when to use it, and a body, in the §SKILL.md§ format Claude uses. Every Skill has a Default that ships with the Harness; an edit is saved as a new Version in the Workspace and can be put back to the Default.

Words not to use for it: Prompt, template, playbook

### Rulebook
The Skill that holds one Pipeline's Rules. It is a Skill like any other (the Agent and Claude read it as §SKILL.md§), but people edit it as Rule cards, not as text.

Words not to use for it: Policy, config, rule set

### Rule
One check a Pipeline makes, written as a plain sentence with its changeable parts as Parameters. It can be switched off, says what happens when it is not met (its Outcome), cites where it comes from and carries the date it took effect. The check itself is code; the Rule only supplies its Parameters.

Words not to use for it: Policy, condition, validation

### Parameter
A value inside a Rule that an admin may change without touching code: a number of days, a rate, an amount, a list.

Words not to use for it: Setting, variable, threshold

### Outcome (of a Rule)
What a Rule that is not met does to the Run: §block§ (the case cannot proceed), §refer§ (a person must look) or §warn§ (noted, the Run goes on).

Words not to use for it: Severity, level

### Version
One saved state of a Skill or a Rule. Saving never overwrites: it adds a Version, and every Run records the Versions it used.

Words not to use for it: Revision, draft

## Work

### Pipeline
A fixed, deterministic piece of desk work made of Steps, such as handling a member request. The same input and the same Rule Versions give the same Findings. Each Pipeline is one tool on the Harness MCP server and is described to the Agent by a Skill.

Words not to use for it: Workflow (the durable-execution SDK's word), flow, process

### Step
One unit of a Pipeline with declared inputs. Steps that do not depend on each other run at the same time. A Step is either code (a Rule check, a calculation, a lookup) or a model call that reads or drafts; only code decides.

Words not to use for it: Job (Casework's word), task, node, stage

### Run
One execution of a Pipeline in a Session. It moves through its Steps, may stop at an Approval and ends §completed§, §returned§, §failed§ or §stopped§.

Words not to use for it: Execution, job, instance

### Finding
What one Rule concluded in one Run: met or not met, the values it compared, and the Rule Version.

Words not to use for it: Result, issue, flag

### Approval
The point where a Run waits for a person. Low-risk Approvals (a letter, a request for missing documents) may be given by any Staff member. High-risk Approvals (a payment instruction, a rejection, a report to the regulator) need an admin who did not start the Run. The Agent cannot give one.

Words not to use for it: Gate, sign-off, review, question

### Draft
The text a Run prepares for a person to approve: a letter, a payment instruction, an employer query, a regulator report.

Words not to use for it: Output, response, document

## Knowledge

### Knowledge base
The documents the Agent may search and cite: guides, forms, policies, circulars. The Workspace starts with seed Sources and grows by upload.

Words not to use for it: RAG store, library, Cabinet (Casework's word)

### Source
One document in the Knowledge base: a PDF, a spreadsheet, a CSV, a text or a web page.

Words not to use for it: File, upload, document (a Document is a case file's paper in Casework)

### Passage
A piece of a Source small enough to retrieve and cite. Search finds Passages by meaning and by words together.

Words not to use for it: Chunk, snippet, node

### Conflict
Two Passages that say different things about the same fact, found when a Source is added. The Agent proposes how to settle it; an admin decides.

Words not to use for it: Contradiction (say it in prose, not as a name), duplicate, clash

### Resolution
What a person decided about a Conflict: the new Passage supersedes the old one, both stay with their dates, or the new one is set aside. A superseded Passage is kept and no longer retrieved.

Words not to use for it: Merge, fix

## Records

### Employer
A company in the pension plan that remits contributions for its Members each month.

### Member
A person with a pension account in the plan. Not a Staff member.

### Schedule
An Employer's monthly file of contribution lines, one per Member.

### Remittance
The money an Employer paid for one month, to be matched to its Schedule.

### Member request
What a Member asks the plan to do: transfer out, withdraw on leaving Cayman, withdraw for property, retire, or a claim on death.

## Oversight

### Audit event
One recorded action: who (a Staff member, the Agent or the system), when, what, on what, in which Session. Agent events also carry the model, tokens and cost. Events are only ever added.

Words not to use for it: Log line, activity, history

### Audit trail
The Audit events of a Session, or of the whole Workspace for an admin.

Words not to use for it: Log, activity feed

### Sandbox
A Vercel Sandbox (a microVM with Node.js and Python and no network) where code runs: the Agent's, for one Session, and a reading Step's, for one model call. The Agent codes in it on its own judgement whenever an answer needs counting, totalling or comparing; nobody has to ask. A Session's Sandbox stops after 10 idle minutes and keeps its files for 24 hours; a Step's is removed when the call ends. What its code prints is analysis, never a Finding.

Words not to use for it: VM, container, terminal, workspace, Runner (the VPS service it replaced, ADR 0022)

## Showing it

### Demo mode
A guided way through the real app. The visitor picks a Scenario and presses Next; each press does the next thing for them (uploads a file, sends a message, opens the Pipeline view, changes Staff) in their own Workspace, with the live model.

Words not to use for it: Tour mode, simulation, playback

### Scenario
One scripted path through the Harness, made of Beats.

Words not to use for it: Tour, walkthrough, script

### Beat
One press of Next in a Scenario: a line saying what is about to happen and the action that does it.

Words not to use for it: Step (a Step belongs to a Pipeline), slide
`,
  ],
};
