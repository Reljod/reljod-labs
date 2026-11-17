import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-audit",
  section: "architecture",
  title: "Audit design",
  summary:
    "One append-only table, enforced by triggers, written in the same function that does the work.",
  body: [
    md`
## One table

§harness.audit_events§ is the record (ADR 0018). Per-feature tables (messages, runs, model calls) answer parts of "what happened". None answers "show me everything that happened in this Session". So every action is also an event here.

An event holds the Owner, the Session and Run if any, an actor, an action from the fixed list, a target, a one-line summary, details, and, for the Agent, the model, tokens and cost.

## Who is recorded

| Actor | What is stored |
| --- | --- |
| **Staff** | The Staff member's id and their name as it was then. |
| **Agent** | The label "Agent", and the model, input tokens, output tokens and cost of the call. |
| **System** | The label "System", for things no one did directly, such as a Run finishing. |

A row must have a Staff id exactly when its actor is Staff. The name is stored on the event so it stays right if Staff change.

## Written where the work is done

A server function writes the event in the same function that does the work, through §audit()§. Where the write and its event must stand or fall together, it uses the transaction's version: §run.started§ is written in the transaction that creates the Run, and the same goes for a saved Rule, a decided Approval and a settled Conflict. Where there is no row to share a transaction with, the event is written strictly **before** the work, and the work is refused if the write fails: §mcp.connected§ before a client is let in, and §sandbox.command§ before a Sandbox command runs. The command's outcome follows as §sandbox.command_finished§. Every other event is best effort and written after the work, so a failure of the trail never loses the work. The action must come from the fixed list in code, and the database also checks its shape.

## Details are made safe

Before saving, details go through a redactor: long strings are cut, long lists and deep objects are trimmed, and any key that looks like a credential (secret, token, password, authorization, api key, cookie, bearer, credential) is replaced with §[redacted]§. For tool calls, the arguments are kept with long values cut.

## Append-only, by trigger

Three triggers refuse changes to the table:

- **update**: always refused.
- **truncate**: always refused.
- **delete**: refused while the event's Workspace exists.

The last rule is how the Owner purge works. Purging deletes the Workspace row. The foreign key cascades the delete to the events, and by the time the cascade reaches an event the Workspace is already gone, so the trigger lets it go. Any other delete finds the Workspace still there and fails.

This was chosen over a transaction setting that switches the check off, because it needs no change to the purge, cannot be switched on by a caller who knows the setting's name, and does not depend on the order the purge walks tables.

## What this does and does not give you

- An application bug or a stray query cannot rewrite history.
- It does **not** stop someone with database owner rights from dropping the triggers. This is an audit trail in a demo, not a tamper-proof ledger.
- Events have no foreign keys to Sessions or Runs, so an event outlives the thing it names.

## Reading it

A user reads their own Sessions' trails. An admin reads the Workspace's. The route pages by event id with a page size set in [Limits](#doc:ref-limits). The list of actions is in [Audit actions](#doc:ref-audit-actions).
`,
  ],
};
