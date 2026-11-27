import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  ForbiddenError,
  InvalidError,
  NotFoundError,
} from "@/platform/errors";
import {
  type AskInput,
  type DecisionInput,
  isUuid,
  type ThreadPatch,
  type ThreadResponse,
} from "../../domain/api";
import {
  type AssistantEvent,
  type CitedFact,
  type Proposal,
  type ThreadMessage,
  type ThreadSummary,
  type TrailStep,
  titleFrom,
} from "../../domain/chat";
import { bookOf } from "../book";
import type {
  Caller,
  Caps,
  ClientStore,
  Desk,
  ThreadStore,
  Turn,
} from "../ports";
import type { ThreadMessageRow, ThreadRow } from "../repository";
import type { BuildService } from "./builds";

export type ThreadPorts = {
  threads: ThreadStore;
  clients: Pick<ClientStore, "get" | "catalog">;
  caps: Pick<Caps, "take">;
  desk: Desk;
  addFacts: BuildService["addFacts"];
  now: () => number;
};

/** Where an answer is asked from, and how to stop it. */
export type Watch = { origin: string; signal?: AbortSignal };

/**
 * Threads: the Desk's conversations, kept for their Owner. Every read and
 * write of a Thread is refused (as not found) for anyone but its Owner; a
 * question takes the `ask` or `research` cap, by writing the question's row,
 * before the Desk calls any model.
 */
export interface ThreadService {
  list(owner: Owner): Promise<ThreadSummary[]>;
  open(caller: Caller, input: ThreadPatch): Promise<ThreadSummary>;
  get(owner: Owner, threadId: string): Promise<ThreadResponse>;
  /** Renames a Thread or changes which client it is about. */
  patch(owner: Owner, threadId: string, input: ThreadPatch): Promise<void>;
  /** A soft delete; the purge cron removes it after 30 days. */
  remove(owner: Owner, threadId: string): Promise<void>;
  /**
   * Resolves once the Thread is the caller's and the cap is taken (the
   * question is saved); then the answer streams. The first question names
   * the Thread.
   */
  ask(
    caller: Caller,
    threadId: string,
    input: AskInput,
    watch: Watch,
  ): Promise<AsyncGenerator<AssistantEvent>>;
  /** The person's pick from a Research card: an addition with the chosen facts, or dismissed. */
  decide(
    caller: Caller,
    threadId: string,
    messageId: string,
    input: DecisionInput,
  ): Promise<{ proposal: Proposal }>;
}

/** A message that asks for research turns Research on by itself. */
const ASKS_FOR_RESEARCH = /^(please\s+)?(research|look\s+up|dig\s+into)\b/i;

const noThread = () => new NotFoundError("That chat is gone.");

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

export function createThreadService(ports: ThreadPorts): ThreadService {
  const { threads, clients } = ports;

  const owned = (thread: ThreadRow | null, owner: Owner) =>
    thread && thread.owner === owner ? thread : null;

  /** A Thread id that is not a uuid names no Thread (and never reaches SQL as one). */
  const known = (threadId: string) => {
    if (!isUuid(threadId)) throw noThread();
  };

  /** A client this Owner may scope a Thread to: one it can see. */
  async function visibleClient(clientId: string | null, owner: Owner) {
    if (!clientId) return null;
    const client = await clients.get(clientId);
    if (!client) throw new NotFoundError("That client is gone.");
    if (!client.is_sample && client.owner !== owner)
      throw new ForbiddenError("That client is not in your book.");
    return client;
  }

  return {
    async list(owner) {
      return (await threads.list(owner)).map(summaryOf);
    },

    async open(caller, input) {
      const client = await visibleClient(input.clientId ?? null, caller.owner);
      const row = await threads.create({
        owner: caller.owner,
        clientId: client?.id ?? null,
        title: input.title,
        visitorHash: caller.visitor.hash,
      });
      return summaryOf({ ...row, client_name: client?.name ?? null });
    },

    async get(owner, threadId) {
      known(threadId);
      // The messages query checks the Owner itself, so both run at once.
      const [thread, messages] = await Promise.all([
        threads.get(threadId),
        threads.messages(threadId, owner),
      ]);
      const mine = owned(thread, owner);
      if (!mine) throw noThread();
      return { thread: summaryOf(mine), messages: messages.map(messageOf) };
    },

    async patch(owner, threadId, input) {
      known(threadId);
      // Both at once; the Thread's refusal comes first.
      const [thread, scope] = await Promise.all([
        threads.get(threadId),
        input.clientId !== undefined
          ? visibleClient(input.clientId, owner).then(
              () => null,
              (error: unknown) => error,
            )
          : null,
      ]);
      if (!owned(thread, owner)) throw noThread();
      if (scope) throw scope;
      await threads.update(threadId, input);
    },

    async remove(owner, threadId) {
      known(threadId);
      const thread = owned(await threads.get(threadId), owner);
      if (!thread) throw noThread();
      await threads.remove(thread.id);
    },

    async ask(caller, threadId, input, watch) {
      known(threadId);
      const { owner, visitor } = caller;
      const research = input.research || ASKS_FOR_RESEARCH.test(input.text);
      // What the answer needs before its first word, read with the Thread
      // (before the question is saved, so the history is the conversation so far).
      const [found, history, catalogRows] = await Promise.all([
        threads.get(threadId),
        threads.history(threadId),
        clients.catalog(owner),
      ]);
      const thread = owned(found, owner);
      if (!thread) throw noThread();
      // The caps (per visitor, per Owner, for everyone) and the question's
      // row in one locked transaction, before any model call.
      await ports.caps.take(
        visitor,
        owner,
        research ? "research" : "ask",
        (db) =>
          threads.addMessage(
            {
              threadId: thread.id,
              owner,
              clientId: thread.client_id,
              role: "user",
              mode: research ? "research" : "ask",
              content: input.text,
              visitorHash: visitor.hash,
            },
            db,
          ),
      );

      const save = (turn: Turn) =>
        threads.addMessage({
          threadId: thread.id,
          owner,
          clientId: turn.buildClientId ?? thread.client_id,
          role: "assistant",
          mode: research ? "research" : "ask",
          content:
            turn.text ||
            (turn.proposal
              ? `Found ${turn.proposal.facts.length} things worth keeping.`
              : turn.buildId
                ? "Adding that to the graph."
                : watch.signal?.aborted
                  ? "Stopped."
                  : "I couldn't find anything on that."),
          traversal: {
            trail: turn.trail,
            cited: turn.cited,
            reasoning: turn.reasoning.slice(0, 4000),
          },
          proposal: turn.proposal,
          buildId: turn.buildId,
          visitorHash: visitor.hash,
        });

      return (async function* () {
        // Only a chat still called "New chat" takes its first question as a title.
        const title =
          history.length === 0 && thread.title === "New chat"
            ? titleFrom(input.text)
            : thread.title;
        if (title !== thread.title) await threads.update(thread.id, { title });
        yield {
          type: "thread",
          thread: summaryOf({
            ...thread,
            title,
            updated_at: new Date(ports.now()),
            client_name:
              catalogRows.find((row) => row.id === thread.client_id)?.name ??
              null,
          }),
        } satisfies AssistantEvent;

        const book = bookOf(catalogRows, visitor.hash);
        const walk = ports.desk.converse({
          origin: watch.origin,
          owner,
          visitor,
          clients: book.clients,
          scopeClientId: thread.client_id,
          research,
          question: input.text,
          history,
          signal: watch.signal,
        });
        let saved = false;
        try {
          let next = await walk.next();
          while (!next.done) {
            yield next.value;
            next = await walk.next();
          }
          const messageId = await save(next.value);
          saved = true;
          yield { type: "done", messageId, cited: next.value.cited };
        } finally {
          // The person stopped mid-answer and the stream closed: the walk
          // ends on the abort; keep what was said so far.
          if (!saved && watch.signal?.aborted) {
            try {
              let next = await walk.next();
              while (!next.done) next = await walk.next();
              if (next.value) await save(next.value);
            } catch {
              // Nothing more to keep.
            }
          }
        }
      })();
    },

    async decide(caller, threadId, messageId, input) {
      known(threadId);
      const [found, message] = await Promise.all([
        threads.get(threadId),
        threads.message(threadId, messageId),
      ]);
      if (!owned(found, caller.owner)) throw noThread();
      const proposal = (message?.proposal as Proposal | null) ?? null;
      if (!message || !proposal) throw new NotFoundError("That card is gone.");
      if (proposal.status !== "open")
        throw new ConflictError("That card was already answered.");
      if (input.action === "dismiss") {
        const next: Proposal = { ...proposal, status: "dismissed" };
        if (!(await threads.decide(message.id, next)))
          throw new ConflictError("That card was already answered.");
        return { proposal: next };
      }
      const chosen = proposal.facts.filter((fact) =>
        input.factIds.includes(fact.id),
      );
      if (chosen.length === 0)
        throw new InvalidError("Pick at least one finding.");
      // Claim the card first, so a double click cannot start two Builds.
      const claimed: Proposal = {
        ...proposal,
        status: "added",
        added: chosen.map((fact) => fact.id),
      };
      if (!(await threads.decide(message.id, claimed)))
        throw new ConflictError("That card was already answered.");
      try {
        const { buildId } = await ports.addFacts(
          caller,
          proposal.clientId,
          {
            facts: chosen.map((fact) => ({
              text: fact.text,
              sourceUrl: fact.sourceUrl,
              sourceTitle: fact.sourceTitle,
            })),
          },
          "research",
        );
        const done: Proposal = { ...claimed, buildId };
        await threads.setProposal(message.id, done);
        return { proposal: done };
      } catch (error) {
        // Hand the card back so the person can try again.
        await threads.setProposal(message.id, proposal);
        throw error;
      }
    },
  };
}
