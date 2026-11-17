# Document compliance Rules are data an Owner edits, and every action is an Audit event

Follows the Harness for Bank demo's split (rules are data, checks are code; audit events are only added), applied to Pre-screens. Amends ADR 0001: the Rulebook is no longer a constant.

The Rulebook was a constant in code (`individualOnboarding`): a proof of address could be 3 months old and no older, a differing name was always `Needs review`, and nobody could ask "what if the limit were 6 months?" without an engineer. Nor could anyone say afterwards which version of a rule produced a Finding, who looked at a flagged Finding, or what the model cost on a given day, short of reading tables one by one.

**Rules.** Each Requirement (and the reading-confidence floor every check uses) is a Rule: a plain sentence with typed Parameters (`days`, `months`, `percent`, `enum`, `list`), an on/off switch and a citation. Defaults ship in `domain/rules.ts`. An edit is checked by `applyRuleEdit` (type, range, step, options) in the browser and again on the server, and saved as the Rule's next Version for the Owner (`document_compliance.rule_versions`). `resolveRulebook` turns the Owner's Rules into the `Rulebook` the checks read; the checks in `domain/evaluate.ts` and `domain/field-checks.ts` stay pure functions. A Pre-screen run stores every Rule's Version and state as it applied them (`prescreen_runs.rules_applied`), so an old Finding can still be explained after a Rule changes.

**Re-evaluation.** Evaluation is pure code over stored readings, so a finished run can be evaluated again with the Owner's current Rules at no model cost. The result is the run's next Evaluation (`document_compliance.evaluations`, numbered from 2; Evaluation 1 is the run's own `findings`). The run page shows any Evaluation and its changes against the one before.

**Reviewer decisions.** A Reviewer settles a flagged Finding of the latest Evaluation as Pass or Fail with a required note (`document_compliance.finding_reviews`, only added to; the newest decision stands). A decision made on an earlier Evaluation stays visible and is marked as such.

**Audit trail.** `document_compliance.audit_events` is the one record of who did what: `run.started`, `document.read` (model, tokens, cost), `run.finished`, `run.failed`, `rule.saved`, `rule.restored`, `run.reevaluated`, `finding.reviewed` (the list in `domain/audit.ts` and the table's check constraint). Triggers refuse UPDATE, TRUNCATE and any DELETE while the Owner's trail row (`audit_trails`) exists; purging an Owner deletes that row and the events go by cascade.

**Pipeline view.** The run page draws the Pre-screen as a graph (`pipeline.ts`): a lane per Document (Parse, Read, Verify, Field checks) joining at Evaluate and Findings, each step with what went in and what came out. Only Read is the model.

## Considered Options

- **Write the Rule's row, then its event, from the app.** Two requests, so a crash between them leaves a Version nobody can account for. Instead `save_rule_version`, `record_evaluation` and `record_review` write the row and its event in one transaction, number Versions and Evaluations under a lock, and apply the caps (`LIMITS` in `domain/review.ts`).
- **Let a Reviewer's override change the Finding.** Simpler to read, but it loses what code concluded. Findings stay as code made them; decisions sit beside them.
- **A foreign key from events to runs.** Runs expire after 30 days and `on delete set null` is an update the trigger refuses, so events keep the run id without a key and outlive the run.

## Consequences

- A new kind of check is a code change; a new value of an existing check is not.
- `run.started` must land before a run starts, so a run whose event cannot be written is failed and costs nothing. `document.read`, `run.finished` and `run.failed` are best effort: a lost event is logged and the work stands.
- Event details never hold a document, a reading in full or a secret: ids, names, counts, Rule Versions and the Reviewer's note, cut by `trimDetails`.
- A Rule's stored Parameters that no longer fit it fall back to the Default when read (`storedRuleState`), so a later change to a Parameter's range cannot break old runs.
- The code needs `20261117170000_document_compliance_rules_audit.sql` applied before it is deployed: starting a run writes `rules_applied` and `run.started`. Reading old runs works without it.
