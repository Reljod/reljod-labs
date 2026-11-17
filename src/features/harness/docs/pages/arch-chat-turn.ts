import { md } from "../md";
import type { DocPage } from "../types";

export const page: DocPage = {
  id: "arch-chat-turn",
  section: "architecture",
  title: "Request path of a chat turn",
  summary:
    "From the browser's POST to the streamed events, and where each check and each Audit event happens.",
  body: [
    md`
## The path

1. **The browser** sends §POST /api/harness/sessions/<id>/chat§ with the text and the ids of any attached Sources.
2. **The proxy** has already turned away anyone without Access.
3. **The route handler** calls the Access gate and resolves the Owner and the Staff member. It checks the Session belongs to that Staff member.
4. **Limits are taken.** Messages an hour and message length are checked, against the visitor.
5. **The message is saved** and recorded as a "Message sent" Audit event.
6. **The Agent's instructions are built.** They hold the desk's context and the name and description of every Skill, but not the bodies.
7. **The model streams.** It can call tools. The tools are the MCP server's, called in process with a short-lived token that names the Owner and the Session's Staff member, plus web search and §load_skill§. A turn is capped at a number of steps.
8. **Each tool call goes through the same server code as a Claude call.** It checks the Role, takes the limit and writes its Audit events.
9. **Events stream back** as one JSON object per line.
10. **The Agent's message is saved** with its tool calls, cards, model, tokens and cost. Its model call is an Audit event with that usage.

## The events

The stream is a sequence of typed events:

| Event | Meaning |
| --- | --- |
| §session§ | The Session this turn belongs to. |
| §text.delta§ | More of the Agent's answer. |
| §reasoning.delta§ | More of its reasoning, where shown. |
| §tool.started§, §tool.finished§ | A tool call began, and how it ended. |
| §skill.loaded§ | A Skill body was loaded. |
| §run.card§ | A Run was started: the id and the Pipeline. |
| §source.card§ | A Source was read or filed. |
| §conflict.card§ | A new Source conflicts with an old one. |
| §usage§ | The model, tokens and cost of the turn. |
| §error§ | The turn failed. The message is for a person. |
| §done§ | The turn is finished, with the saved message's id. |

## Why in-process

The built-in chat calls the MCP server's code directly instead of over the network. It is the same code, with the same checks, so there is nothing for the chat to do that Claude cannot, apart from web search and §load_skill§.

## What can go wrong

- **A limit.** The turn is refused with a 429 and a sentence that says which limit.
- **A model failure.** An §error§ event ends the stream. The user's message is kept.
- **A Run still goes on.** A Run the turn started is its own workflow. If the stream dies, the Run does not.
`,
  ],
};
