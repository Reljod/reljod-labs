import { isUuid } from "../../core/db";
import { InvalidError, NotFoundError } from "../../core/errors";
import {
  type ChatEvent,
  historyOf,
  partsOf,
  titleFrom,
} from "../../domain/chat";
import { LIMITS } from "../../domain/limits";
import type {
  BankRate,
  PreparedTurn,
  SessionRepository,
  StaffContext,
  Teller,
} from "../ports";

const GONE = "That conversation is not in this bank.";

export interface ChatService {
  /**
   * One message to the Teller. Resolves once the message is checked (the
   * Session is the Owner's, the text fits, the hourly cap is taken) and
   * saved; the answer then streams as ChatEvents and ends with `done`.
   */
  turn(input: {
    context: StaffContext;
    sessionId: string;
    text: string;
    origin: string;
    signal: AbortSignal;
  }): Promise<AsyncIterable<ChatEvent>>;
}

export type ChatPorts = {
  sessions: SessionRepository;
  rate: BankRate;
  teller: Teller;
};

/*
 * The harness owns the caps, the Owner scope and the saving of the turn; the
 * Teller (the model, or the e2e suite's canned turn) owns only the answer.
 */
export function createChatService(ports: ChatPorts): ChatService {
  const { sessions, rate, teller } = ports;
  return {
    async turn({ context, sessionId, text: raw, origin, signal }) {
      const { owner, visitor } = context;
      const text = raw.trim();
      if (!text) throw new InvalidError("Say something first.");
      if (text.length > LIMITS.messageChars) {
        throw new InvalidError(
          `A message is at most ${LIMITS.messageChars} characters.`,
        );
      }
      if (!isUuid(sessionId)) throw new NotFoundError(GONE);
      // Both are scoped to the Owner, so they can run together.
      const [before, earlier] = await Promise.all([
        sessions.find(owner, sessionId),
        sessions.messages(owner, sessionId),
      ]);
      if (!before) throw new NotFoundError(GONE);
      await rate.take("message", visitor, { owner });
      if (
        !(await sessions.append({
          owner,
          sessionId: before.id,
          role: "person",
          content: text,
        }))
      )
        throw new NotFoundError(GONE);
      const first = earlier.length === 0;
      const session = first
        ? ((await sessions.rename(owner, before.id, titleFrom(text))) ?? before)
        : before;

      const turn: PreparedTurn = {
        context,
        session,
        text,
        origin,
        history: historyOf(earlier),
        spend: (kind) => rate.take(kind, visitor, { owner }),
        async finish(content, events, usage) {
          const messageId = await sessions.append({
            owner,
            sessionId: session.id,
            role: "teller",
            content,
            parts: partsOf(events),
            usage,
          });
          if (!messageId) throw new NotFoundError(GONE);
          return { type: "done", messageId };
        },
      };

      async function* answer(): AsyncGenerator<ChatEvent> {
        if (first) yield { type: "session", session };
        yield* teller.answer(turn, signal);
      }
      return eager(answer());
    },
  };
}

/**
 * Runs a turn to its end whether or not anyone is still reading. A visitor
 * who closes the tab stops the stream (and the request's signal stops the
 * model), but the Teller still saves what it said, marked "(stopped)":
 * those steps were paid for. Reading stops when the reader does.
 */
export function eager<E>(source: AsyncIterator<E>): AsyncIterable<E> {
  const buffered: IteratorResult<E>[] = [];
  const state: {
    failure: { error: unknown } | null;
    wake: (() => void) | null;
  } = { failure: null, wake: null };
  let done = false;
  void (async () => {
    try {
      for (;;) {
        const next = await source.next();
        buffered.push(next);
        state.wake?.();
        if (next.done) break;
      }
    } catch (error) {
      state.failure = { error };
      state.wake?.();
    }
  })();
  return {
    [Symbol.asyncIterator]: () => ({
      async next(): Promise<IteratorResult<E>> {
        for (;;) {
          if (done) return { value: undefined, done: true };
          const next = buffered.shift();
          if (next) {
            if (next.done) done = true;
            return next;
          }
          if (state.failure) {
            done = true;
            throw state.failure.error;
          }
          await new Promise<void>((resolve) => {
            state.wake = resolve;
          });
          state.wake = null;
        }
      },
      async return(): Promise<IteratorResult<E>> {
        done = true;
        return { value: undefined, done: true };
      },
    }),
  };
}
