# Every action by a person or the Agent is an Audit event, and events are only added

A bank must be able to say who did what, when, with which rule and which model. Per-feature tables (messages, runs, model calls) answer parts of that and none of them answers "show me everything that happened in this Session".

`harness.audit_events` is the one record. Each event has the Owner, the Session (if any), an actor (`staff` with the Staff member, `agent`, or `system`), an action from a fixed list in `domain/audit.ts`, a target, and details. Agent events also carry the model, input and output tokens and cost. Server code writes an event through `audit()` in the same function that does the work: a message sent, a file uploaded, a tool called, a Step finished, a Finding made, an Approval given, a Skill or Rule saved, a Conflict settled, a Sandbox command, a change of Staff. A database trigger refuses updates and deletes.

A user sees their own Sessions' trails. An admin sees the whole Workspace's.

## Consequences

- The Audit tab reads one table, filtered by Session, actor and action.
- Details never hold a secret or a whole document: ids, names, sizes, Rule Versions, and for tool calls the arguments with long values cut.
- Events are purged only with the Workspace, through the Owner purge (ADR 0011); the trigger allows that cascade.
- Demo mode's Beats run as the chosen Staff member, so they are audited like anything else.
