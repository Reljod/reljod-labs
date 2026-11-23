# Firebreak

A crisis drill for chief executives. The visitor takes the chair of a fictional Meridia company on its worst morning and decides, Round by Round, for 72 hours. A model voices everyone around the table; code keeps the score, the clock and the law.

## Language

**Drill**:
One run of a Scenario, from the first Inject to the Review. It lives in the visitor's browser as its Rounds and is replayed by the Engine on every request.
_Avoid_: Game, session, simulation run

**Scenario**:
A company on its worst morning, as data (`domain/scenarios.ts`): its Stakeholders, Levers, Injects, Burns, Rules and Statement rules, and the recorded path.
_Avoid_: Level, case

**Slot**:
A fixed hour on the crisis clock at which an Inject lands (T+0h, T+3h, …). A Drill has one Round per Slot.

**Round**:
One decision: the Inject that landed, the Choice, and the Levers it pulled. The Engine turns a Round into an Outcome.
_Avoid_: Turn (a Turn is the HTTP request that plays a Round), move

**Inject**:
Something that lands on the desk at a Slot: a letter, a leak, a phone call. It carries Pressure and three Options, and may have a Condition. The word is the one crisis exercises use.
_Avoid_: Event, card (the UI may draw it as a card)

**Option**:
One of the three choices printed on an Inject, pulling one or two Levers.

**Choice**:
How a Round was decided: an Option, or the executive's own words (which the Reader turns into Levers).

**Lever**:
Something the executive can do, with fixed Effects. Pulled once; pulling it again does nothing. A Lever may lose value when **late**.
_Avoid_: Action, tool

**Effects**:
What a Lever, an Inject's Pressure or a Burn does to the Gauges (points) and to the Cost (florin millions).

**Burn**:
Damage that repeats every Round until one of its Levers is pulled ("Nobody has told passengers anything").

**Gauge**:
Where one Stakeholder stands, 0 to 100: customers, regulator, staff, press, operations, board. **Heat** is 100 minus the mean of the Gauges.

**Stakeholder**:
One of the six people around the table, one per Gauge, with a voice the Room speaks in.
_Avoid_: Character, agent, persona

**Engine**:
`domain/engine.ts`. The only code that moves a number. Pure: a Drill is `play(scenario, rounds)`.

**Room**:
The model voicing the Stakeholders after a Round, writing a headline and posts, a whisper from the chief of staff, and picking the next Inject from those the Engine allows.

**Reader**:
The model turning the executive's own words into at most three Levers. It never moves a number.

**Rule**:
A line the response is judged by, as data: `by` a deadline, `before` another step, or `never`. Checked by `domain/rules.ts` into a **Finding** that is met, open, missed or broken.

**Review**:
The After-Action Review at T+72h: a grade, the heat line, the Findings, and the Statement.
_Avoid_: Debrief in the UI (the route is called `debrief`)

**Statement**:
The public statement the **Comms lead** (the model) drafts at the end, checked by `domain/statement.ts` and sent back with Notes until it clears or runs out of drafts.

**Recorded drill**:
A Drill played in the browser from the Scenario's recorded path and its Stakeholders' own lines. No model, no network.
