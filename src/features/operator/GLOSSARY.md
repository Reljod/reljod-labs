# Operator

One agent that works a system nobody can integrate with: it looks at the screen and uses the keyboard and mouse, live, while Rules decide what it may commit and code decides whether the work was done correctly. Decisions: `docs/adr/0025-the-operator-keys-through-a-guard.md`, `docs/adr/0026-the-legacy-system-is-a-state-machine-in-the-sandbox.md`.

## Language

**Operator**:
The one agent. It is shown the Screen as a picture and answers with Actions. It has no API to the legacy system and decides nothing about its own correctness.
_Avoid_: Bot, RPA, assistant, Analyst (that is Sieve's)

**HARBOURMASTER**:
The legacy system: the manifest and berth system of the fictional Port Authority of Meridia. An 80 by 24 green-screen terminal application with function keys and no API. In code, `legacy/`.
_Avoid_: Mainframe, backend, the app

**Screen**:
One 80 by 24 display of HARBOURMASTER, named by its Screen code (`HMV200`). Also the live picture the page shows.
_Avoid_: Page, view, form

**Books**:
What HARBOURMASTER keeps: Vessels, Manifest lines, Holds and Berth bookings.
_Avoid_: Database, state, records table

**Fixture**:
The Books a Task starts from, with the sign-on and the traps that are armed. Every Run of a Task starts from the same Fixture.

**Task**:
What a person wants done, in plain words. A sample Task also has a Fixture, Expectations and a Script. An own Task is the visitor's words, with or without a Manifest.
_Avoid_: Job (Casework), Step, prompt

**Manifest**:
A cargo manifest file (CSV or PDF, Meridia, SPECIMEN) attached to a Task: the rows to key.
_Avoid_: Upload, document, source

**Expectation**:
One change the Books must show after a sample Task, and the checklist line that says so.

**Script**:
A correct solution of a sample Task as a list of Actions. The stubbed Operator plays it in tests; a recorded Run is one played for real.

**Run**:
One attempt at a Task by one Driver, from sign-on to the checks: its Trail, its Frames, its cost and its Verdict.
_Avoid_: Session (HARBOURMASTER has sessions), job, execution

**Driver**:
Who is at the keyboard in a Run: the Operator, an outside MCP client (Claude), or the visitor by hand.

**Take the keyboard**:
The visitor drives HARBOURMASTER by hand. The same machine runs in their browser; the server replays what they keyed and checks it with the same code.
_Avoid_: Manual mode, sandbox mode

**Action**:
One thing done to the Screen: a click, typing, key presses, a scroll or a wait. The Operator's tools and the MCP tools both produce Actions.
_Avoid_: Step, command, event

**Turn**:
One model call of the Operator. A Turn asks for one or more Actions.

**Frame**:
The picture of the Screen after one Action, numbered from 0 (the sign-on Screen). Replaying a Run is stepping through its Frames.
_Avoid_: Screenshot (in code names), snapshot

**Rule**:
One thing the Operator may or may not do, as data: a switch and Parameters. The Rules together are the Rulebook.

**Rulebook**:
The Rules, versioned per Owner. Version 0 is the Default. A Run records the version it ran under.

**Guard**:
The code that sees every keystroke before HARBOURMASTER does. It asks what the key would change, applies the Rules, and allows it, refuses it, or pauses the Run.
_Avoid_: Filter, policy engine, middleware

**Approval**:
A person's decision on a paused Action: approved or refused. Never the Operator's, and never a client's on a Run it drives.

**Finding**:
What a check returned after the Run: a Rule or an Expectation, a level (pass, fail, warn, info) and a sentence. Only code returns one.

**Verdict**:
`correct`, `incorrect` or `unverified`, computed from the Findings. `unverified` means the Rules held but there was nothing to compare the outcome with (an own Task without a Manifest).
_Avoid_: Score, result, status

**Trail**:
A Run's events, append-only and ordered: every Turn, Action, Frame, Rule that fired, pause, decision, piece of code and Finding.
_Avoid_: Log, history; "Audit trail" is fine in prose

**Replay**:
Stepping through a finished Run's Frames. A recorded Run ships with the site so there is something to watch before anyone spends anything.

**Skill**:
A playbook the Operator loads on demand: reading a terminal Screen, keying a Manifest, recovering from a timeout or a lock.

**Screen sandbox**:
The Vercel Sandbox of a Run, with no network: HARBOURMASTER, a headless browser showing it, and the Guard between them.

**Code sandbox**:
A second Vercel Sandbox with no network where `run_code` runs: parse the Manifest, check container numbers, diff what was keyed. It cannot reach the Screen sandbox.
