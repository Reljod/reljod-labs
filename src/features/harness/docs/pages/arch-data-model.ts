import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-data-model",
  section: "architecture",
  title: "Data model",
  summary: "The §harness§ schema, table by table, and how it is purged.",
  body: [
    md`
The schema is §harness§, in §supabase/migrations/20261117120000_harness.sql§. It needs the §vector§ extension. Every table has an §owner§ column and a foreign key to §harness.workspaces§ with §on delete cascade§. The tables are reached only from server code over a direct Postgres connection. Row level security is on with no policies, so the Data API sees nothing.

## Workspace and people

| Table | What it holds |
| --- | --- |
| §workspaces§ | One row per Owner. When it was seeded, and which seed version. The only Harness table registered for the Owner purge. |
| §staff§ | A Workspace's Staff: a stable §key§ (for example §officer-1§), name, title, §role§ (§user§ or §admin§) and initials. |

## Conversation

| Table | What it holds |
| --- | --- |
| §sessions§ | A Session: its Staff member, title and status. |
| §messages§ | Messages. §role§ is §staff§ or §agent§. A staff message names its Staff member. §parts§ holds tool calls, attachments and cards. Agent messages carry model, tokens and cost. |
| §sandboxes§ | One row per Session that has a Sandbox: the container, its status and when it was last used. |

## Skills and Rules

| Table | What it holds |
| --- | --- |
| §skill_versions§ | A saved Version of a Skill: name, description, body, who saved it and a note. No rows means the Default applies. |
| §rule_versions§ | A saved Version of a Rule: enabled, §params§ as JSON, Outcome, effective date, who and a note. No rows means the Default applies. |

## Knowledge base

| Table | What it holds |
| --- | --- |
| §sources§ | A Source: title, kind, storage path, size, status, the date the document carries, and the Session it came from. |
| §passages§ | A Passage: heading, body, a 768-dimension §embedding§ with an HNSW index, a generated §search§ column with a GIN index, and §superseded_by§. |
| §conflicts§ | A Conflict: the new and old Passage, a summary, the proposed Resolution, the status, the Resolution and who decided. |

## Records

| Table | What it holds |
| --- | --- |
| §employers§ | Code, name, status. |
| §members§ | Member number, name, dates, residency, balance (KYD), status. |
| §schedules§ | An Employer's month and status. |
| §schedule_lines§ | One line per Member: earnings, employee, employer and voluntary amounts. |
| §remittances§ | An Employer's month and the amount received. |
| §member_requests§ | A Member's request: kind, status, amount, details and the latest Run. |

## Runs

| Table | What it holds |
| --- | --- |
| §runs§ | A Run: Pipeline, status, input, result, the Rule Versions applied, who started it, how (§chat§, §mcp§, §app§ or §demo§) and the workflow run id. |
| §run_steps§ | One row per Step: status, times, output, error and, for a model Step, model, tokens and cost. |
| §findings§ | A Finding: Rule, Rule Version, Step, met or not, Outcome, summary, and the values compared. |
| §approvals§ | An Approval: kind, risk, the Draft, status, the hook token, who decided and the note. |

## Oversight and limits

| Table | What it holds |
| --- | --- |
| §audit_events§ | The Audit trail. See [Audit design](#doc:arch-audit). |
| §rate_hits§ | One row per unit of capped work, counted per hour against the visitor's salted hash, not the Owner. Old rows are deleted daily. |

## Search function

§harness.search_passages(owner, query, embedding, limit)§ does hybrid search. See [Hybrid search and the Conflict check](#doc:arch-search).

## Purge

The Owner purge (ADR 0011) deletes the Workspace row, and everything else goes by cascade. §harness.workspaces§ is the only Harness table in §access.owned_tables§. Registering another would break the purge, because the Audit trail refuses direct deletes.

## Storage

A private bucket named §harness§ holds uploaded Sources, with a size cap that repeats the app's.
`,
  ],
};
