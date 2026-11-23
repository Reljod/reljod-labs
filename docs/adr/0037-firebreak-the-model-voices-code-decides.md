# 0037. Firebreak: the model voices the room, code decides every number

Date: 2026-11-23. Status: accepted.

## Context

A crisis drill for executives is only worth running if the consequences are fair and repeatable: the same decisions at the same hours must cost the same, a missed legal deadline must be missed whatever the model says, and a visitor must not be able to talk the scorekeeper round. A model is good at the part people remember (the regulator's cold letter, the journalist's next question) and bad at being a ledger.

Qwen4-Max (Alibaba, 16 November 2026) is sold as an agent that delivers a first version and revises it from feedback. A public statement written under pressure is exactly that loop, if something other than the model gives the feedback.

## Decision

**The Engine owns every number.** `domain/engine.ts` is pure: a Drill is `play(scenario, rounds)`. Pressure, Levers (with lateness), Burns, clamping, cost and the share index are all there. The model has three roles and none of them can move a Gauge:

- the **Reader** maps free text to at most three Levers from a closed list (`cleanReading` drops anything else);
- the **Room** speaks after the Engine has played the Round, from the numbers it is given, and picks the next Inject only from `eligibleInjects` (`cleanNext` falls back to the first);
- the **Comms lead** drafts the Statement.

**Rules are data, checks are code.** Each Scenario's Rules are `by` / `before` / `never`, checked by `domain/rules.ts`. The Statement's checks (who, an action, a time for the next update, no speculation, no blame, an apology when owed, no promise of a Lever not pulled) are in `domain/statement.ts`; a failed check becomes a Note, and the Comms lead revises against the Notes, up to three drafts.

**Stateless.** Nothing is saved. The browser holds the Rounds and the Room's earlier lines; every Turn and Review sends them back and the server replays them through the Engine, refusing a Round the Engine could not have produced (an Inject not eligible then, an Option from another card, an unknown Lever). The only table is the rate limiter's.

**The recorded drill is the same code.** It plays in the browser from the Scenario's recorded path and its Stakeholders' own lines, through the Engine, the reporter and the checks, so a visitor can watch a whole drill with no model call, and the end-to-end test drives the real routes with the same canned output.

## Consequences

- The Engine, the Rules, the Statement's checks and the balance of every Scenario are unit-tested without a model; a test fails if the careful path does not grade A or B and the reckless one D or E.
- The Room's lines can contradict a number (a Stakeholder sounding calmer than their Gauge). The prompt gives it the numbers and the mood must match the sign; the numbers on screen are always the Engine's.
- A visitor can forge a Reader's Levers by editing the Rounds they send back. It changes only their own drill, which is never saved or shown to anyone else.
- Statement checks match words, not meaning, so a good Statement can be sent back for a missing word. The lists are in each Scenario and the revision loop usually fixes it in one draft.
