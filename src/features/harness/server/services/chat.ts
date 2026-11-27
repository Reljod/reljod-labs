import "server-only";
import { InvalidError } from "@/platform/errors";
import type { AuditUsage } from "../../domain/audit";
import type { ChatEvent } from "../../domain/chat-events";
import { historyOf, partsOf } from "../../domain/chat-turn";
import type { SourceView } from "../../domain/knowledge";
import type { MessagePart } from "../../domain/session";
import type { Actor, AgentTurn, Caller, ChatAgent } from "../ports";
import type { SessionService } from "./sessions";

/** Attachments one message may carry. */
export const MAX_ATTACHMENTS = 10;

/**
 * One chat turn (ADR 0013): the Staff message is saved first (the Session
 * must be the Staff member's own, the attachments the Owner's, and the
 * message passes the caps), then the Agent answers as a stream of
 * ChatEvents, saved as the Agent's message when it ends or is stopped.
 */
export interface ChatService {
  /** Resolves once the message is saved (refusals are thrown before any event); then the turn streams. */
  turn(
    caller: Caller,
    sessionId: string,
    message: { text: string; attachments: string[] },
    context: { origin: string; signal: AbortSignal },
  ): Promise<AsyncGenerator<ChatEvent>>;
}

export function createChatService(ports: {
  sessions: SessionService;
  sources: (actor: Actor) => Promise<SourceView[]>;
  agent: ChatAgent;
}): ChatService {
  const { sessions, agent } = ports;

  /** The attached Sources that are the Owner's; anything else is dropped. */
  async function attachedSources(actor: Actor, ids: string[]) {
    if (ids.length === 0) return [];
    const sources = await ports.sources(actor);
    return ids.flatMap((id) => {
      const source = sources.find((item) => item.id === id);
      return source ? [source] : [];
    });
  }

  return {
    async turn(caller, sessionId, message, { origin, signal }) {
      if (message.attachments.length > MAX_ATTACHMENTS) {
        throw new InvalidError(
          `A message carries at most ${MAX_ATTACHMENTS} attachments.`,
        );
      }
      const before = await sessions.writable(caller, sessionId);
      const [earlier, attached] = await Promise.all([
        sessions.messages(caller, before.id),
        attachedSources(caller, [...new Set(message.attachments)]),
      ]);
      const parts: MessagePart[] = attached.map((source) => ({
        type: "attachment",
        sourceId: source.id,
        name: source.title,
        kind: source.kind,
        bytes: source.bytes,
      }));
      const { session } = await sessions.sendStaff(
        caller,
        before,
        message.text,
        parts,
      );
      const turn: AgentTurn = {
        caller,
        session,
        text: message.text,
        attached: attached.map((source) => ({
          sourceId: source.id,
          title: source.title,
          kind: source.kind,
          status: source.status,
        })),
        history: historyOf(earlier),
        origin,
      };
      const renamed = session.title !== before.title;

      return (async function* (): AsyncGenerator<ChatEvent> {
        if (renamed) yield { type: "session", session };
        const events: ChatEvent[] = [];
        let text = "";
        let saved = false;
        const save = async (content: string, usage: AuditUsage | null) => {
          saved = true;
          const { message: reply } = await sessions.sendAgent(
            caller.owner,
            session,
            content,
            partsOf(events),
            usage,
          );
          return reply.id;
        };
        const stopped = () => `${text.trim()} (stopped)`.trim();
        const answer = agent.answer(turn, signal);
        try {
          for (;;) {
            const next = await answer.next();
            if (next.done) {
              const id = await save(
                signal.aborted ? stopped() : text.trim(),
                next.value.usage,
              );
              yield { type: "done", messageId: id };
              return;
            }
            const event = next.value;
            if (event.type === "text.delta") text += event.text;
            events.push(event);
            yield event;
          }
        } catch (error) {
          if (!signal.aborted) throw error;
        } finally {
          // Stopped mid-answer (the visitor left or pressed Stop): keep what was said so far.
          if (!saved && signal.aborted) {
            await save(stopped(), null).catch(() => null);
          }
          await answer.return?.({ usage: null }).catch(() => undefined);
        }
      })();
    },
  };
}
