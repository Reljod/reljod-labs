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

Use **Attach files**, or **Sample files** for the samples. A file is uploaded as soon as you add it, and it goes with your next message. An attachment is a **pending Source**: attached, not filed. It has no Passages, search does not find it and no Conflict check has run. The Agent can:

- **read** it to answer a question, without keeping it;
- **file** it in the Knowledge base (the §file_source§ tool), where it is split into Passages, embedded and checked for Conflicts. It does this only when you ask it to keep a document;
- **hand it to a Pipeline**, for example a Schedule to Contribution processing.

The Agent keeps track of what was attached for the whole Session, not just the turn it came with: every turn its instructions list the Session's attachments (title, kind, filed or not, and the Source id the tools take), and earlier messages keep their attachments in the history it reads. So "run it again on the paper I attached earlier" works. If the Agent names a paper by its file name or title instead of its id, the tools look it up among this Session's attachments and go ahead when exactly one fits; otherwise the tool's answer lists them with their ids. The §list_attachments§ tool lists them too (§list_sources§ shows only filed Sources).

Each attachment chip on your message, and each source card, has a **Preview** button that opens the document raw in the Knowledge tab. A person can also file it later from the Knowledge tab. Files are limited in size, and you can add only so many an hour.

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
