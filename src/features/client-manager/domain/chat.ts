import type { Certainty } from "./confidence";
import type { TraversalStep, Usage } from "./events";

/**
 * The book-wide chat: Threads in a browser session, each asking about every
 * client or about one. The assistant knows the clients only through the
 * Client Manager MCP server, and can research one on the web and propose
 * what to add.
 */

export const MAX_MESSAGE_LENGTH = 2000;
/** Facts one research turn may propose, and one approval may add. */
export const MAX_PROPOSED_FACTS = 20;

export type ThreadSummary = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  preview: string;
  updatedAt: string;
};

export type WebResult = { url: string; title: string };

/** Where a tool call walked: one client's graph, one Traversal step. */
export type Walk = { clientId: string; step: TraversalStep };

/** One tool call in an answer: what it was asked, what it found, where. */
export type TrailStep = {
  callId: string;
  tool: string;
  input: unknown;
  ok?: boolean;
  summary?: string;
  walks?: Walk[];
  web?: WebResult[];
};

/** A fact the answer cited, resolved to the client and Node it names. */
export type CitedFact = {
  ref: string;
  clientId: string;
  clientName: string;
  key: string;
  label: string;
};

export type ProposedFact = {
  id: string;
  text: string;
  certainty: Certainty;
  sourceUrl: string | null;
  sourceTitle: string | null;
};

/** What a research turn found, waiting for the person to pick what to keep. */
export type Proposal = {
  clientId: string;
  clientName: string;
  facts: ProposedFact[];
  status: "open" | "added" | "dismissed";
  added: string[];
  buildId: string | null;
};

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  research: boolean;
  trail: TrailStep[];
  cited: CitedFact[];
  proposal: Proposal | null;
  buildId: string | null;
  clientId: string | null;
  createdAt: string;
};

export type AssistantEvent =
  | { type: "thread"; thread: ThreadSummary }
  | { type: "tool"; callId: string; name: string; input: unknown }
  | {
      type: "tool-result";
      callId: string;
      ok: boolean;
      summary: string;
      walks?: Walk[];
      web?: WebResult[];
    }
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "build"; clientId: string; buildId: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; messageId: string | null; cited: CitedFact[] }
  | { type: "error"; message: string };

/** A Thread's title from its first question: the words, not a model call. */
export function titleFrom(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= 60) return line || "New chat";
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 30 ? space : 60)}…`;
}
