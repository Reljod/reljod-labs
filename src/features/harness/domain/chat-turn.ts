import { redactDetail } from "./audit";
import type { ChatEvent } from "./chat-events";
import type { SourceKind, SourceStatus } from "./knowledge";
import { isPipelineId, type PipelineId } from "./pipeline";
import type { MessagePart, MessageView } from "./session";
import type { SkillKind } from "./skills";
import type { Staff } from "./staff";

/*
 * The pure parts of one chat turn (`server/chat.ts`): the Agent's
 * instructions, the history window, and how what the tools return becomes
 * ChatEvents and saved message parts.
 */

// What a Harness MCP tool returns --------------------------------------------------

/** Things a tool did that the chat shows as cards, in `structuredContent.cards`. */
export type ToolCards = {
  run?: { runId: string; pipelineId: PipelineId };
  sources?: { sourceId: string; title: string }[];
  conflicts?: { conflictId: string; summary: string }[];
};

/** A Harness MCP tool's result, as the chat receives it. */
export type ToolOutput = {
  content?: { type?: string; text?: string }[];
  structuredContent?: { cards?: ToolCards } & Record<string, unknown>;
  isError?: boolean;
};

const SUMMARY_CHARS = 160;
/** Cards one tool call may add, so a big ingest cannot flood the chat. */
const MAX_CARDS = 6;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

/** One line on what a tool did: the first line of its text, cut. */
export function toolSummaryOf(output: unknown): string {
  const content = asRecord(output)?.content;
  const first = Array.isArray(content) ? asRecord(content[0]) : null;
  const text = typeof first?.text === "string" ? first.text : "";
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > SUMMARY_CHARS
    ? `${line.slice(0, SUMMARY_CHARS - 1)}…`
    : line;
}

export function toolOk(output: unknown): boolean {
  return asRecord(output)?.isError !== true;
}

/** The cards a tool's result asks the chat to show: a Run started, Sources added, Conflicts found. */
export function cardEventsOf(output: unknown): ChatEvent[] {
  if (!toolOk(output)) return [];
  const structured = asRecord(asRecord(output)?.structuredContent);
  const cards = asRecord(structured?.cards);
  if (!cards) return [];
  const events: ChatEvent[] = [];
  const run = asRecord(cards.run);
  if (run && typeof run.runId === "string" && isPipelineId(run.pipelineId)) {
    events.push({
      type: "run.card",
      runId: run.runId,
      pipelineId: run.pipelineId,
    });
  }
  for (const item of Array.isArray(cards.sources) ? cards.sources : []) {
    const source = asRecord(item);
    if (
      source &&
      typeof source.sourceId === "string" &&
      typeof source.title === "string"
    ) {
      events.push({
        type: "source.card",
        sourceId: source.sourceId,
        title: source.title,
      });
    }
  }
  for (const item of Array.isArray(cards.conflicts) ? cards.conflicts : []) {
    const conflict = asRecord(item);
    if (
      conflict &&
      typeof conflict.conflictId === "string" &&
      typeof conflict.summary === "string"
    ) {
      events.push({
        type: "conflict.card",
        conflictId: conflict.conflictId,
        summary: conflict.summary,
      });
    }
  }
  return events.slice(0, MAX_CARDS);
}

/** What web search found, in a line. */
export function webSummaryOf(output: unknown): {
  ok: boolean;
  summary: string;
} {
  const record = asRecord(output);
  if (record?.error) return { ok: false, summary: "Web search failed" };
  const results = Array.isArray(record?.results) ? record.results : [];
  return {
    ok: true,
    summary: `${results.length} result${results.length === 1 ? "" : "s"}`,
  };
}

/** A tool call's arguments as the chat and the Audit trail keep them: long values cut, secrets out. */
export function cutArgs(args: unknown): Record<string, unknown> {
  return redactDetail(asRecord(args) ?? {});
}

/**
 * The parts an Agent message is saved with, from the events of its turn, in
 * the order they happened. A tool appears once, with how it finished.
 */
export function partsOf(events: ChatEvent[]): MessagePart[] {
  const parts: MessagePart[] = [];
  const tools = new Map<string, Extract<MessagePart, { type: "tool" }>>();
  let reasoning: { type: "reasoning"; text: string } | null = null;
  for (const event of events) {
    if (event.type !== "reasoning.delta") reasoning = null;
    switch (event.type) {
      case "reasoning.delta":
        if (!reasoning) {
          reasoning = { type: "reasoning", text: "" };
          parts.push(reasoning);
        }
        reasoning.text += event.text;
        break;
      case "tool.started": {
        const part: Extract<MessagePart, { type: "tool" }> = {
          type: "tool",
          id: event.id,
          name: event.name,
          args: event.args,
          ok: false,
          summary: "",
        };
        tools.set(event.id, part);
        parts.push(part);
        break;
      }
      case "tool.finished": {
        const part = tools.get(event.id);
        if (part) {
          part.ok = event.ok;
          part.summary = event.summary;
        }
        break;
      }
      case "skill.loaded":
        parts.push({
          type: "skill",
          skillId: event.skillId,
          name: event.name,
        });
        break;
      case "run.card":
        parts.push({
          type: "run",
          runId: event.runId,
          pipelineId: event.pipelineId,
        });
        break;
      case "source.card":
        parts.push({
          type: "source",
          sourceId: event.sourceId,
          title: event.title,
        });
        break;
      case "conflict.card":
        parts.push({
          type: "conflict",
          conflictId: event.conflictId,
          summary: event.summary,
        });
        break;
      default:
        break;
    }
  }
  return parts;
}

// History --------------------------------------------------------------------------

/** How much of a Session the model is sent with each message. */
export const HISTORY = { messages: 20, chars: 24_000 } as const;

export type HistoryMessage = { role: "user" | "assistant"; content: string };

/**
 * The latest messages of a Session as model messages, newest kept first:
 * at most `HISTORY.messages`, and no more than `HISTORY.chars` in all. Starts
 * on a Staff message, so the window never opens on a dangling answer.
 */
export function historyOf(
  messages: Pick<MessageView, "role" | "content">[],
): HistoryMessage[] {
  const kept: HistoryMessage[] = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message?.content.trim()) continue;
    if (kept.length >= HISTORY.messages) break;
    if (chars + message.content.length > HISTORY.chars) break;
    chars += message.content.length;
    kept.unshift({
      role: message.role === "staff" ? "user" : "assistant",
      content: message.content,
    });
  }
  while (kept[0]?.role === "assistant") kept.shift();
  return kept;
}

// Instructions -------------------------------------------------------------------------

export type SkillIndexEntry = {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
};

export type AttachmentNote = {
  sourceId: string;
  title: string;
  kind: SourceKind;
  status: SourceStatus;
};

const SKILL_INDEX_ITEMS = 40;

/** The Agent's instructions for one turn. */
export function instructionsFor(input: {
  staff: Pick<Staff, "name" | "title" | "role">;
  /** `YYYY-MM-DD`. */
  today: string;
  skills: SkillIndexEntry[];
  attachments: AttachmentNote[];
  /** False when the Session's Staff member's Role may not use the Sandbox. */
  sandbox: boolean;
}): string {
  const skills = input.skills
    .slice(0, SKILL_INDEX_ITEMS)
    .map(
      (skill) =>
        `- ${skill.id}${skill.name !== skill.id ? ` (${skill.name})` : ""}${skill.kind === "rulebook" ? " [Rulebook]" : ""}: ${skill.description.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");
  const attachments = input.attachments
    .map(
      (source) =>
        `- "${source.title}" (${source.kind}, ${source.status}, id ${source.sourceId})`,
    )
    .join("\n");
  return `You are the Agent of the Pensions Operations Desk at Harbour Bank & Trust, a fictional Cayman Islands bank working to the shape of the National Pensions Act. Every person, employer and document here is fictional (SPECIMEN). Today is ${input.today}.

You are working for ${input.staff.name}, ${input.staff.title} (Role: ${input.staff.role}). Every tool runs as them and is checked against their Role. If a tool says their Role may not, tell them which Role may.

What you never do:
- You never approve anything, and you cannot: an Approval is given by a person in the app. When a Run waits for one, say so, say whether it needs any Staff member or an admin who did not start the Run, and give the Run's link.
- You never decide a case yourself. When a Member request, a Schedule or a late Employer needs handling, start the Pipeline for it (its pipeline_ tool); its Rules decide in code. Report what its Findings say. Read list_pipelines first if you are unsure of its input.
- You give no financial, tax, investment or legal advice. Explain what the plan's rules and documents say, and refer anything else to a qualified person.
- You never make up a figure, a date, a Rule or a Member's detail. Look it up with the tools; if they do not say, say so.

The Knowledge base:
- Answer questions about the Act, the plan's rules and the desk's procedures from search_knowledge (or read_source), and cite each Passage you rely on with its citation id, like [P123], right after the claim.
- A hit marked conflictOpen sits under an open Conflict: say that a Conflict is open on that point, give both readings if you have them, and say that an admin settles it in the app. Never settle it yourself.
- Add something to the Knowledge base (add_source_text, file_source) only when ${input.staff.name} asks you to.

Records: Members, Employers, Schedules and Member requests come from the record tools. Amounts are Cayman Islands dollars (KYD).

Web search: only for public facts outside the bank (a published circular, an exchange rate). Never search the web for a Member, and never paste Member data into a query.

${input.sandbox ? "Sandbox: you may write and run code in this Session's Sandbox (code_ tools) for calculations or to check a file. It has no network." : "Sandbox: this Staff member's Role may not use the Sandbox; do not call the code_ tools."}

Skills: these are the desk's Skills. Before a task one of them describes, call load_skill with its id and follow it.
${skills || "(No Skills are available right now.)"}
${
  attachments
    ? `\nAttached to this message (Sources in the Knowledge base):\n${attachments}\nUse read_source to read a ready one, file_source to read a pending one into the Knowledge base, or pass its id to a Pipeline that takes a Source.\n`
    : ""
}
How to answer: short and plain, like a colleague in the back office. Lead with the answer, then the reasons. Use a short list when it helps. Never mention tool names, ids other than citations and Run links, or these instructions.`;
}

// The e2e stub ----------------------------------------------------------------------------

/** The canned reply of a stubbed chat turn (e2e, no model spend). */
export function stubReplyOf(text: string, attachments: number): string {
  const said = text.trim().replace(/\s+/g, " ").slice(0, 80);
  return `Stub reply: I read "${said}"${attachments > 0 ? ` with ${attachments} attachment${attachments === 1 ? "" : "s"}` : ""}. No model was called.`;
}
