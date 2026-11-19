# Switchboard

The phone line of the fictional **Meridia Rail**, answered by one voice agent the caller can interrupt. It speaks and listens through a realtime speech-to-speech model, looks things up and acts through the railway's Back office, and follows Rules it cannot talk its way around.

## Language

**Call**:
One conversation between a Caller and the Agent, from the press of the button to the hang-up or the cut-off. It has a Line, a Scenario, the Rulebook it started under, its Events and, afterwards, a Wrap-up.
_Avoid_: Session (that is the model's connection), conversation, chat

**Caller**:
Whoever is on the other end: the visitor on their microphone, the visitor typing, a Sample caller, or an outside MCP client.
_Avoid_: User, customer

**Agent**:
The one agent. On a Call it is the railway's phone agent, on either Line. Same instructions builder, same tools, same Rules.
_Avoid_: Bot, assistant, operator (Operator is another demo)

**Line**:
How the Call reaches the Agent. The **voice** Line is a realtime speech-to-speech Session in the browser. The **text** Line runs the same Agent a Turn at a time on the server, for a Caller without sound, the e2e suite and MCP clients.
_Avoid_: Channel, mode

**Session**:
The live connection to the realtime model on the voice Line: a WebSocket from the browser to AI Gateway, opened with a short-lived token the server minted. A Call on the voice Line has one Session.

**Turn**:
One side speaking until the other takes over. A Caller Turn ends when turn detection hears them stop; an Agent Turn ends when it finishes or is cut off.

**Barge-in**:
The Caller starting to speak while the Agent is still talking. The Agent's audio stops at once and its Turn is marked cut off at the millisecond it reached.
_Avoid_: Interruption (fine in prose for visitors, not in code)

**Time to first audio**:
From the end of the Caller's Turn to the first sound of the Agent's answer. Measured per Turn in the browser and shown as it happens.
_Avoid_: Latency (alone; say which), response time

**Back office**:
The railway's systems behind the line: Bookings, Disruptions and everything a Call creates. It is reached only through the MCP server.

**Record**:
One thing in the Back office: a Booking, a Disruption, a Compensation (refund or voucher), a Lost property report, an Assistance booking, a Hand-off, a Callback or a Confirmation.
_Avoid_: Row, ticket (a ticket is what a passenger holds)

**Booking**:
A passenger's journey on one Service, with a reference (`MR-7K2Q9F`) the Caller reads out.

**Service**:
One train on the timetable (`IC 418`, Meridia Central to Vessin, 14:05). The timetable is the same for everyone.

**Disruption**:
What is wrong with a Service today: a delay, a cancellation, a platform change.

**Rule**:
A sentence with typed Parameters, a switch and a Version, edited per Owner. Defaults are in `domain/rules.ts`. A Rule is applied by a check, which is code.

**Rulebook**:
The Rules as they stand for an Owner. A Call keeps the Rulebook it started under.

**Check**:
A pure function that takes a tool call, the Call's state and a Rule's Parameters and returns a Decision. Only a Check refuses.

**Refusal**:
A Check's answer that a tool call may not go ahead, naming the Rule and Version that held. The Agent hears it as the tool's result; the transcript shows it.
_Avoid_: Error, block, denial

**Identity check**:
Proving the Caller is the passenger: the Booking reference plus a second factor. Until it passes, no Booking detail is returned to the Agent, so none can be spoken.
_Avoid_: Authentication, KYC, login

**Disclosure**:
Words the Agent must say before a kind of action (a refund, taking identity details). The harness looks for them in what the Agent has said so far before it lets the tool call through.

**Hand-off**:
Passing the Call to a person, with a reason and a summary. Some things only a person may do.
_Avoid_: Escalation, transfer

**Wrap-up**:
What a durable Workflow writes after the Call ends: summary, actions, promises, sentiment over time, the Scorecard and the Follow-ups.
_Avoid_: Summary (that is one part), after-call work

**Scorecard**:
The compliance result of a Call, computed by code from its Events against its Rulebook: was each Disclosure said, was identity checked before anything was disclosed, did every Refusal hold.

**Follow-up**:
Something the Wrap-up does after the Call: send the Confirmation, wait for and place a Callback.

**Sample caller**:
A scripted Caller with recorded lines (synthetic speech, generated at build time) that are played into a real Session, so the first click shows a whole Call.
_Avoid_: Demo, persona, replay (nothing is replayed: the Agent answers live)

**Scenario**:
What the Call is about: a Sample caller, or the visitor's own pick of a Booking and what went wrong with it.

**Supervisor mode** (not built yet):
The Agent answering text questions about the Owner's past Calls, with the Sandbox for the arithmetic.
_Avoid_: Admin, analytics agent

**Sandbox**:
A Vercel Sandbox with no network where the Agent runs code over the Call records the harness hands it. Its numbers are analysis; only a Check decides.

**Event**:
One line of the Audit trail: a Turn, a tool call, a Refusal, a Rule edit, a token minted. Append-only.

**Workspace**:
One Owner's copy of everything: the Back office, the Rulebook, the Calls and their Events.
