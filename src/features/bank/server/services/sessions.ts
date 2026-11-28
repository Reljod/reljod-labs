import type { Owner } from "@/features/access/domain/owner";
import { isUuid } from "../../core/db";
import { LimitError, NotFoundError } from "../../core/errors";
import type { MessageView, SessionSummary } from "../../domain/chat";
import { LIMITS } from "../../domain/limits";
import type { ConfirmationView } from "../../domain/views";
import type {
  Later,
  Sandboxes,
  SessionRepository,
  StaffContext,
} from "../ports";

export type SessionDetail = {
  session: SessionSummary;
  messages: MessageView[];
  confirmations: ConfirmationView[];
};

const GONE = "That conversation is not in this bank.";

/**
 * The Owner's conversations with the Teller. Every read and write is scoped
 * to the Owner; deleting one is soft, and the purge cron removes it with its
 * messages 30 days later.
 */
export interface SessionService {
  list(owner: Owner): Promise<SessionSummary[]>;
  /** One conversation: its messages and the requests in it that wait for the person. */
  detail(owner: Owner, sessionId: string): Promise<SessionDetail>;
  create(
    context: StaffContext,
    customerId: string | null,
  ): Promise<SessionSummary>;
  remove(owner: Owner, sessionId: string): Promise<void>;
}

export type SessionPorts = {
  sessions: SessionRepository;
  sandboxes: Sandboxes;
  later: Later;
};

export function createSessionService(ports: SessionPorts): SessionService {
  const { sessions } = ports;
  return {
    list: (owner) => sessions.list(owner),

    async detail(owner, sessionId) {
      if (!isUuid(sessionId)) throw new NotFoundError(GONE);
      // One round trip: the messages and confirmations are scoped to the Owner too.
      const [session, messages, confirmations] = await Promise.all([
        sessions.find(owner, sessionId),
        sessions.messages(owner, sessionId),
        sessions.confirmations(owner, sessionId),
      ]);
      if (!session) throw new NotFoundError(GONE);
      return { session, messages, confirmations };
    },

    async create(context, customerId) {
      if ((await sessions.count(context.owner)) >= LIMITS.sessionsPerBank) {
        throw new LimitError(
          `This bank keeps at most ${LIMITS.sessionsPerBank} conversations. Delete one first.`,
        );
      }
      return sessions.create(context.owner, context.staff.id, customerId);
    },

    async remove(owner, sessionId) {
      if (!isUuid(sessionId) || !(await sessions.remove(owner, sessionId)))
        throw new NotFoundError(GONE);
      ports.later(() => ports.sandboxes.dispose(sessionId));
    },
  };
}
