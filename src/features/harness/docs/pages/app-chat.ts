import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "app-chat",
  section: "using",
  title: "Chat",
  summary: "Sessions, attachments, sample files, web search and the run cards.",
  body: [
    md`
The [Chat tab](#tab:chat) is where you work with the Agent.

## Sessions

Each conversation is a Session. Start a new one for a new case. A Session keeps its messages, its uploads, its Runs and its Audit trail. You can have several Sessions at work at once: one can be waiting for an Approval while you start another. Sessions are yours: you see your own, and an admin sees the Workspace's. A Workspace keeps a limited number of Sessions. See [Limits](#doc:ref-limits).

## Sending a message

Type and send. The Agent's turn streams back: its text, its reasoning where it shows it, and each tool it calls with a one-line result. A message has a character limit, and you can send only so many an hour.

## Attachments

You can attach files to a message. An attachment is a **pending Source**. The Agent can:

- **read** it to answer a question, without keeping it;
- **file** it in the Knowledge base, where it is split into Passages, embedded and checked for Conflicts;
- **hand it to a Pipeline**, for example a Schedule to Contribution processing.

Files are limited in size, and you can add only so many an hour.

## Sample files

The attachment control offers sample case papers: SPECIMEN documents of the fictional bank. Use them to try each Pipeline without writing your own.

## Web search

When the Knowledge base cannot answer, the Agent may search the web. That is a Connector of its own, and each search is an Audit event. Treat web results as less certain than your Knowledge base.

## Cards in the conversation

- A **run card** appears when the Agent starts a Run. **View pipeline** opens it in the [Pipelines tab](#tab:pipelines).
- A **source card** appears when a Source is read or filed.
- A **conflict card** appears when a new Source disagrees with an old one. An admin settles it in the [Knowledge tab](#tab:knowledge).

## If a turn stops

The Agent may stop at its step limit, or a model call may fail. The message says so. Nothing is lost: Runs it started keep going.

## Staff and Sessions

A Session belongs to the Staff member who opened it. If you switch Staff, the open Session may not be yours any more, and the app moves you on. See [Staff switcher](#doc:app-staff).
`,
  ],
};
