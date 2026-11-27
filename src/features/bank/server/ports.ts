import type { Owner } from "@/features/access/domain/owner";
import type { Access } from "@/features/access/server/gate";
import type { RateLimiter } from "@/platform/rate/limiter";
import type { Visitor } from "@/platform/request/visitor";
import type { Actor } from "../core/actor";
import type { AuditInput } from "../core/audit";
import type {
  ChatEvent,
  MessagePart,
  MessageView,
  SessionSummary,
} from "../domain/chat";
import type { WriteOutcome } from "../domain/commands";
import type { Staff } from "../domain/staff";
import type { ConfirmationView, GrowthView } from "../domain/views";
import type { Usage } from "./llm";

/*
 * What the bank's services need from the outside world. The container
 * (`container.ts`) wires the real adapters (the command engine in `core/`,
 * Postgres, the outbox, the model gateway, the Sandbox); unit tests and the
 * stubbed e2e suite hand in fakes. The ledger's own invariants (balanced
 * entries, funds, append-only) stay in the database and the engine, behind
 * `CommandEngine`.
 */

/** Who a request acts as: its Access, the Owner whose bank it reaches, the Staff member signed in, and the visitor its caps count against. */
export type StaffContext = {
  access: Access;
  owner: Owner;
  staff: Staff;
  everyone: Staff[];
  visitor: Visitor;
};

/** Who a command runs for: the Actor (Owner, Staff, via) and the visitor whose hourly caps it spends. */
export type Caller = { actor: Actor; visitor: Visitor };

/** The command engine (`core/engine.ts`): validation, Role, idempotency, Confirmation, Approval, handler, Audit, outbox. */
export interface CommandEngine {
  read(actor: Actor, name: string, input: unknown): Promise<unknown>;
  write(
    actor: Actor,
    name: string,
    input: unknown,
    idempotencyKey: string | null,
  ): Promise<WriteOutcome>;
}

/** The transactional outbox, dispatched (`outbox.ts`). Never throws. */
export interface Outbox {
  kick(owner: Owner, options?: { wake?: boolean }): Promise<void>;
}

/** The Growth tab's view: the database and GitHub (`growth.ts`). */
export interface GrowthReader {
  view(owner: Owner): Promise<GrowthView>;
}

/** The Owner's Staff, with the bank opened (and seeded) on first use. */
export interface StaffRepository {
  /** Every Staff member of the Owner's bank, seeding the bank first if it is new. */
  open(owner: Owner): Promise<Staff[]>;
  find(owner: Owner, staffId: string): Promise<Staff | null>;
}

/** The append-only Audit trail (`bank.audit_events`). */
export interface AuditLog {
  record(actor: Actor, event: AuditInput): Promise<void>;
}

/** Signs bank MCP tokens with the server's secret (`mcp-auth.ts`). */
export interface TokenSigner {
  /** A token for an outside client, acting as the Staff member signed in now. */
  client(context: StaffContext): { token: string; expiresAt: number };
  /** The Teller's own token for one chat turn in one Session. */
  chat(context: StaffContext, sessionId: string): string;
}

export type NewMessage = {
  owner: Owner;
  sessionId: string;
  role: "person" | "teller";
  content: string;
  parts?: MessagePart[];
  usage?: Usage | null;
};

/** Chat Sessions and their messages. Every call is scoped to the Owner and skips soft-deleted Sessions. */
export interface SessionRepository {
  list(owner: Owner): Promise<SessionSummary[]>;
  /** The Session, or null when it is not the Owner's (or deleted). */
  find(owner: Owner, sessionId: string): Promise<SessionSummary | null>;
  count(owner: Owner): Promise<number>;
  create(
    owner: Owner,
    staffId: string,
    customerId: string | null,
  ): Promise<SessionSummary>;
  /** Soft delete; false when there was no such Session of the Owner's. */
  remove(owner: Owner, sessionId: string): Promise<boolean>;
  rename(
    owner: Owner,
    sessionId: string,
    title: string,
  ): Promise<SessionSummary | null>;
  messages(owner: Owner, sessionId: string): Promise<MessageView[]>;
  /** The new message's id, or null when the Session is gone. */
  append(message: NewMessage): Promise<string | null>;
  confirmations(owner: Owner, sessionId: string): Promise<ConfirmationView[]>;
}

/** The Teller's Sandboxes, one per Session. */
export interface Sandboxes {
  /** Stops and deletes a Session's Sandbox; never throws. */
  dispose(sessionId: string): Promise<void>;
}

/** One chat turn, checked and saved, handed to the Teller. */
export type PreparedTurn = {
  context: StaffContext;
  session: SessionSummary;
  text: string;
  origin: string;
  history: { role: "user" | "assistant"; content: string }[];
  /** Takes one unit of a capped kind of work (the Sandbox) before it runs. */
  spend: (kind: "sandbox") => Promise<void>;
  /** Saves the Teller's reply and answers the turn's last event. */
  finish: (
    content: string,
    events: ChatEvent[],
    usage: Usage | null,
  ) => Promise<ChatEvent>;
};

/** The model side of a chat turn: the live Teller, or the e2e suite's canned one. */
export interface Teller {
  answer(turn: PreparedTurn, signal: AbortSignal): AsyncGenerator<ChatEvent>;
}

export type SpendKind = "message" | "write" | "sandbox";

export type BankRate = RateLimiter<SpendKind>;

/** Runs work after the answer is sent (`after` in Next; inline in tests and scripts). */
export type Later = (work: () => Promise<unknown>) => void;
