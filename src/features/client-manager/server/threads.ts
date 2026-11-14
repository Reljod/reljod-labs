import "server-only";
import { z } from "zod";
import {
  type AssistantEvent,
  type CitedFact,
  MAX_MESSAGE_LENGTH,
  type Proposal,
  type ThreadMessage,
  type ThreadSummary,
  type TrailStep,
  titleFrom,
} from "../domain/chat";
import { converse } from "./assistant";
import { bookOf } from "./graph-tools";
import {
  addThreadMessage,
  createThread,
  decideProposal,
  getClient,
  getThread,
  getThreadMessage,
  listCatalog,
  listThreads,
  researchSince,
  setProposal,
  type ThreadMessageRow,
  type ThreadRow,
  threadHistory,
  threadMessages,
  updateThread,
} from "./repository";
import { addFacts, checkLimits, LIMITS, LimitError } from "./service";
import type { Visitor } from "./session";

/** Threads: the book-wide chat of one browser session. */

export function summaryOf(
  row: ThreadRow & { client_name?: string | null; preview?: string | null },
): ThreadSummary {
  return {
    id: row.id,
    title: row.title,
    clientId: row.client_id,
    clientName: row.client_name ?? null,
    preview: (row.preview ?? "")
      .replace(/\[\[[^\]]+\]\]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function threadsOf(sessionId: string | null) {
  if (!sessionId) return [];
  return (await listThreads(sessionId)).map(summaryOf);
}

export async function ownedThread(threadId: string, sessionId: string | null) {
  const thread = await getThread(threadId);
  return thread && sessionId && thread.session_id === sessionId ? thread : null;
}

/** Whether this session may scope a Thread to the client: one it can see. */
async function visibleClient(clientId: string | null, sessionId: string) {
  if (!clientId) return null;
  const client = await getClient(clientId);
  if (!client) throw new LimitError("That client is gone.");
  if (!client.is_sample && client.session_id !== sessionId)
    throw new LimitError("That client is not in your book.");
  return client;
}

export const threadPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  clientId: z.string().uuid().nullable().optional(),
});

export async function openThread(
  raw: unknown,
  sessionId: string,
  visitor: Visitor,
): Promise<ThreadSummary> {
  const input = threadPatchSchema.parse(raw ?? {});
  const client = await visibleClient(input.clientId ?? null, sessionId);
  const row = await createThread({
    sessionId,
    clientId: client?.id ?? null,
    title: input.title,
    visitorHash: visitor.hash,
  });
  return summaryOf({ ...row, client_name: client?.name ?? null });
}

export async function patchThread(
  thread: ThreadRow,
  raw: unknown,
  sessionId: string,
) {
  const input = threadPatchSchema.parse(raw);
  if (input.clientId !== undefined)
    await visibleClient(input.clientId, sessionId);
  await updateThread(thread.id, input);
}

function messageOf(row: ThreadMessageRow): ThreadMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    research: row.mode === "research",
    trail: (row.traversal?.trail ?? []) as TrailStep[],
    cited: (row.traversal?.cited ?? []) as CitedFact[],
    proposal: (row.proposal as Proposal | null) ?? null,
    buildId: row.build_id,
    clientId: row.client_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function messagesOf(thread: ThreadRow) {
  return (await threadMessages(thread.id)).map(messageOf);
}

export const askSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  research: z.boolean().default(false),
});

/** A message that asks for research turns Research on by itself. */
const ASKS_FOR_RESEARCH = /^(please\s+)?(research|look\s+up|dig\s+into)\b/i;

/**
 * One question in a Thread: checks the limits, saves the question, streams
 * the answer as AssistantEvents and saves it. The first question names the
 * Thread.
 */
export async function* ask(input: {
  thread: ThreadRow;
  raw: unknown;
  sessionId: string;
  visitor: Visitor;
  origin: string;
  signal?: AbortSignal;
}): AsyncGenerator<AssistantEvent> {
  const { text, research: asked } = askSchema.parse(input.raw);
  const research = asked || ASKS_FOR_RESEARCH.test(text);
  await checkLimits(input.visitor, "ask");
  if (
    research &&
    !input.visitor.trusted &&
    (await researchSince(
      input.visitor.hash,
      new Date(Date.now() - 3_600_000),
    )) >= LIMITS.researchPerHour
  ) {
    throw new LimitError(
      `That's ${LIMITS.researchPerHour} research runs this hour. Ask without Research, or try again soon.`,
    );
  }

  const { thread } = input;
  const history = await threadHistory(thread.id);
  if (history.length === 0) {
    await updateThread(thread.id, { title: titleFrom(text) });
  }
  await addThreadMessage({
    threadId: thread.id,
    sessionId: input.sessionId,
    clientId: thread.client_id,
    role: "user",
    mode: research ? "research" : "ask",
    content: text,
    visitorHash: input.visitor.hash,
  });
  const fresh = await getThread(thread.id);
  if (fresh) {
    const client = fresh.client_id ? await getClient(fresh.client_id) : null;
    yield {
      type: "thread",
      thread: summaryOf({ ...fresh, client_name: client?.name ?? null }),
    };
  }

  const book = bookOf(await listCatalog(input.sessionId), input.visitor.hash);
  const walk = converse({
    origin: input.origin,
    sessionId: input.sessionId,
    visitor: input.visitor,
    clients: book.clients,
    scopeClientId: thread.client_id,
    research,
    question: text,
    history,
    signal: input.signal,
  });
  let next = await walk.next();
  while (!next.done) {
    yield next.value;
    next = await walk.next();
  }
  const turn = next.value;
  const messageId = await addThreadMessage({
    threadId: thread.id,
    sessionId: input.sessionId,
    clientId: turn.buildClientId ?? thread.client_id,
    role: "assistant",
    mode: research ? "research" : "ask",
    content:
      turn.text ||
      (turn.proposal
        ? `Found ${turn.proposal.facts.length} things worth keeping.`
        : turn.buildId
          ? "Adding that to the graph."
          : input.signal?.aborted
            ? "Stopped."
            : "I couldn't find anything on that."),
    traversal: {
      trail: turn.trail,
      cited: turn.cited,
      reasoning: turn.reasoning.slice(0, 4000),
    },
    proposal: turn.proposal,
    buildId: turn.buildId,
    visitorHash: input.visitor.hash,
  });
  yield { type: "done", messageId, cited: turn.cited };
}

export const decisionSchema = z.object({
  action: z.enum(["add", "dismiss"]),
  factIds: z.array(z.string().max(16)).max(40).default([]),
});

/** The person's pick from a research card: start an addition with the chosen facts, or dismiss it. */
export async function decide(input: {
  thread: ThreadRow;
  messageId: string;
  raw: unknown;
  visitor: Visitor;
}): Promise<Proposal> {
  const { action, factIds } = decisionSchema.parse(input.raw);
  const message = await getThreadMessage(input.thread.id, input.messageId);
  const proposal = (message?.proposal as Proposal | null) ?? null;
  if (!message || !proposal) throw new LimitError("That card is gone.");
  if (proposal.status !== "open")
    throw new LimitError("That card was already answered.");
  if (action === "dismiss") {
    const next: Proposal = { ...proposal, status: "dismissed" };
    await decideProposal(message.id, next);
    return next;
  }
  const chosen = proposal.facts.filter((fact) => factIds.includes(fact.id));
  if (chosen.length === 0) throw new LimitError("Pick at least one finding.");
  const client = await getClient(proposal.clientId);
  if (!client) throw new LimitError("That client is gone.");
  if (client.session_id !== input.thread.session_id && !input.visitor.trusted)
    throw new LimitError(
      "Samples are read-only. Research one of your own clients to add findings.",
    );
  // Claim the card first, so a double click cannot start two Builds.
  const claimed: Proposal = {
    ...proposal,
    status: "added",
    added: chosen.map((fact) => fact.id),
  };
  if (!(await decideProposal(message.id, claimed)))
    throw new LimitError("That card was already answered.");
  try {
    const { buildId } = await addFacts(
      client,
      {
        facts: chosen.map((fact) => ({
          text: fact.text,
          sourceUrl: fact.sourceUrl,
          sourceTitle: fact.sourceTitle,
        })),
      },
      input.visitor,
      "research",
    );
    const done: Proposal = { ...claimed, buildId };
    await setProposal(message.id, done);
    return done;
  } catch (error) {
    // Hand the card back so the person can try again.
    await setProposal(message.id, proposal);
    throw error;
  }
}
