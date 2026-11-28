import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  ForbiddenError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import type { AuditUsage } from "../../domain/audit";
import { LIMITS } from "../../domain/limits";
import { can } from "../../domain/permissions";
import {
  type MessagePart,
  type MessageView,
  NEW_SESSION_TITLE,
  SESSION_PREVIEW_CHARS,
  SESSION_TITLE_CHARS,
  type SessionSummary,
  titleFrom,
} from "../../domain/session";
import { assertCan } from "../errors";
import type {
  Actor,
  Attachment,
  HarnessRate,
  PaidActor,
  SessionRepository,
} from "../ports";

/** A message saved, and its Session as it stands after it. */
export type Appended = { message: MessageView; session: SessionSummary };

/**
 * Sessions (one Staff member's conversations with the Agent) and their
 * messages. A Session is its Staff member's own: an admin may read anyone's
 * (they read the whole Audit trail, which points at them), nobody writes in
 * another's.
 */
export interface SessionService {
  list(actor: Actor): Promise<SessionSummary[]>;
  /** The Session if this Staff member may read it, else null. */
  readable(actor: Actor, sessionId: unknown): Promise<SessionSummary | null>;
  /** The Session if it is this Staff member's own; 404 when it is not in the Workspace, 403 when it is someone else's. */
  writable(actor: Actor, sessionId: unknown): Promise<SessionSummary>;
  get(actor: Actor, sessionId: string): Promise<SessionSummary>;
  create(actor: Actor, title?: string | null): Promise<SessionSummary>;
  rename(
    actor: Actor,
    sessionId: string,
    title: string,
  ): Promise<SessionSummary>;
  messages(actor: Actor, sessionId: string): Promise<MessageView[]>;
  /**
   * A Staff message: the paid entry point of a chat turn, so the caps are
   * here: the Session is the Staff member's own, the text at most
   * `LIMITS.messageChars`, and it takes one of the visitor's messages this
   * hour. The first message names a Session still called "New session".
   */
  sendStaff(
    actor: PaidActor,
    session: SessionSummary,
    content: string,
    parts: MessagePart[],
  ): Promise<Appended>;
  /** The Agent's answer, with what the turn cost (on the message, not its event). */
  sendAgent(
    owner: Owner,
    session: SessionSummary,
    content: string,
    parts: MessagePart[],
    usage: AuditUsage | null,
  ): Promise<Appended>;
  attachments(owner: Owner, sessionId: string): Promise<Attachment[]>;
}

function cleanTitle(raw: unknown): string {
  if (typeof raw !== "string")
    throw new InvalidError("Give the Session a title.");
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) throw new InvalidError("Give the Session a title.");
  if (title.length > SESSION_TITLE_CHARS) {
    throw new InvalidError(
      `A Session's title is at most ${SESSION_TITLE_CHARS} characters.`,
    );
  }
  return title;
}

const NOT_HERE = "That Session is not in this Workspace.";

export function createSessionService(ports: {
  sessions: SessionRepository;
  rate: HarnessRate;
}): SessionService {
  const { sessions, rate } = ports;

  async function readable(actor: Actor, sessionId: unknown) {
    const session = await sessions.owned(actor.owner, sessionId);
    if (!session) return null;
    return session.staff.id === actor.staff.id ||
      can(actor.staff, "audit.read.workspace")
      ? session
      : null;
  }

  async function writable(actor: Actor, sessionId: unknown) {
    const session = await sessions.owned(actor.owner, sessionId);
    if (!session) throw new NotFoundError(NOT_HERE);
    if (session.staff.id !== actor.staff.id) {
      throw new ForbiddenError(
        `This Session belongs to ${session.staff.name}. Switch Staff to write in it.`,
      );
    }
    return session;
  }

  async function append(
    owner: Owner,
    session: SessionSummary,
    message: Parameters<SessionRepository["append"]>[0]["message"],
  ): Promise<Appended> {
    const staff = message.role === "staff" ? message.staff : null;
    const title =
      staff && session.title === NEW_SESSION_TITLE && message.content.trim()
        ? titleFrom(message.content)
        : session.title;
    const saved = await sessions.append({
      owner,
      sessionId: session.id,
      title,
      message,
      event: (messageId) => ({
        owner,
        sessionId: session.id,
        actor: staff ? { kind: "staff", staff } : { kind: "agent" },
        action: "message.sent",
        summary: staff ? "Sent a message" : "Answered",
        target: { kind: "message", id: messageId },
        detail: {
          chars: message.content.length,
          parts: message.parts.map((part) => part.type),
        },
        // Cost and tokens live on `model.called` only (one event per call).
        usage: null,
      }),
    });
    return {
      message: {
        id: saved.id,
        sessionId: session.id,
        role: message.role,
        staff: message.staff
          ? {
              id: message.staff.id,
              name: message.staff.name,
              initials: message.staff.initials,
            }
          : null,
        content: message.content,
        parts: message.parts,
        usage: message.usage,
        createdAt: saved.createdAt,
      },
      session: {
        ...session,
        title,
        updatedAt: new Date().toISOString(),
        preview: message.content
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, SESSION_PREVIEW_CHARS),
      },
    };
  }

  return {
    list: (actor) => sessions.list(actor.owner, actor.staff.id),
    readable,
    writable,

    async get(actor, sessionId) {
      const session = await readable(actor, sessionId);
      if (!session) throw new NotFoundError(NOT_HERE);
      return session;
    },

    async create(actor, raw) {
      assertCan(actor.staff, "session.create");
      const title = raw ? cleanTitle(raw) : NEW_SESSION_TITLE;
      const id = await sessions.create({
        owner: actor.owner,
        staffId: actor.staff.id,
        title,
        max: LIMITS.sessionsPerWorkspace,
        event: (sessionId) => ({
          owner: actor.owner,
          sessionId,
          actor: { kind: "staff", staff: actor.staff },
          action: "session.created",
          summary: "Opened a Session",
          target: { kind: "session", id: sessionId },
        }),
      });
      if (id === null)
        throw new LimitError(
          `A Workspace keeps ${LIMITS.sessionsPerWorkspace} Sessions. Carry on in one you have.`,
        );
      const session = await sessions.owned(actor.owner, id);
      if (!session) throw new Error("Session was not created");
      return session;
    },

    async rename(actor, sessionId, raw) {
      const session = await writable(actor, sessionId);
      const title = cleanTitle(raw);
      if (title === session.title) return session;
      await sessions.rename(actor.owner, session.id, title, {
        owner: actor.owner,
        sessionId: session.id,
        actor: { kind: "staff", staff: actor.staff },
        action: "session.renamed",
        summary: `Renamed the Session to "${title}"`,
        target: { kind: "session", id: session.id },
        detail: { from: session.title, to: title },
      });
      return { ...session, title, updatedAt: new Date().toISOString() };
    },

    async messages(actor, sessionId) {
      // Both are scoped to the Owner and start together; the messages are
      // answered only when the Staff member may read the Session.
      const [session, messages] = await Promise.all([
        readable(actor, sessionId),
        sessions.messages(actor.owner, sessionId),
      ]);
      if (!session) throw new NotFoundError(NOT_HERE);
      return messages;
    },

    async sendStaff(actor, session, content, parts) {
      if (session.staff.id !== actor.staff.id) {
        throw new ForbiddenError(
          `This Session belongs to ${session.staff.name}. Switch Staff to write in it.`,
        );
      }
      if (!content.trim() && parts.length === 0) {
        throw new InvalidError("Write a message first.");
      }
      if (content.length > LIMITS.messageChars) {
        throw new InvalidError(
          `A message is at most ${LIMITS.messageChars} characters.`,
        );
      }
      await rate.take("message", actor.visitor, { owner: actor.owner });
      return append(actor.owner, session, {
        role: "staff",
        staff: actor.staff,
        content,
        parts,
        usage: null,
      });
    },

    sendAgent: (owner, session, content, parts, usage) =>
      append(owner, session, {
        role: "agent",
        staff: null,
        content,
        parts,
        usage,
      }),

    attachments: (owner, sessionId) => sessions.attachments(owner, sessionId),
  };
}
