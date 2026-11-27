import type { Owner } from "@/features/access/domain/owner";
import type { Visitor } from "@/platform/request/visitor";
import type { RateUse, SessionGrantView } from "../domain/api";
import type {
  Actor,
  CallEvent,
  CallStatus,
  CallSummary,
  CallView,
  EventData,
  EventType,
  Line,
  ReportedEvent,
  Scenario,
  Wrapup,
} from "../domain/contract";
import type { RuleVersionRow } from "../domain/rules";
import type { BackOfficeRecord } from "../domain/world";

/*
 * What Switchboard's services need from outside the process. The container
 * (`container.ts`) wires the adapters: the SQL in `store.ts` and `calls.ts`,
 * the model gateway, Vercel Sandbox and the Workflow SDK. Unit tests hand in
 * fakes; the stubbed e2e suite gets the canned Agent (`domain/stub.ts`), a
 * canned Sandbox and a Session grant that opens nothing.
 */

/** Who a Switchboard call is for: the Owner it is scoped to and the visitor whose caps it spends. */
export type Caller = { owner: Owner; visitor: Visitor };

// The database ------------------------------------------------------------------------

export type NewCall = {
  owner: Owner;
  line: Line;
  origin: "app" | "mcp";
  model: string;
  scenario: Scenario;
  consentAudio: boolean;
};

export type ToolInput = {
  owner: Owner;
  callId: string;
  toolCallId: string;
  name: string;
  args: unknown;
  /** What the Agent has said in the Turn it is still speaking. */
  saying?: string;
  /** What the Caller said that the transcript does not hold yet. */
  hearing?: string;
};

export type ToolOutcome = {
  ok: boolean;
  output: Record<string, unknown>;
  summary: string;
  events: CallEvent[];
  /** Set when the Call is no longer live: the caller must hang up. */
  over: CallStatus | null;
};

export type ReportOutcome = {
  accepted: number;
  status: CallStatus;
  costUsd: number;
  /** The server cut the Call off while taking the report. */
  cut: boolean;
};

/** The Wrap-up's note, from the model or written by code. */
export type Note = Pick<
  Wrapup,
  "summary" | "actions" | "promises" | "sentiment" | "analysis"
> & { model: string; costUsd: number };

/**
 * Everything Switchboard keeps. Every method takes the Owner and scopes by
 * it (ADR 0011); each write that needs an Event records it in the same
 * transaction. A Call's writes run under its row lock (the Workspace first,
 * then the Call), which is why they are whole units of work here.
 */
export interface SwitchboardStore {
  /** Creates the Owner's Workspace with its Back office on first use. */
  ensureWorkspace(owner: Owner): Promise<void>;
  /** The Back office back to its seed, the old Records archived; false while a Call is live. */
  resetRecords(owner: Owner): Promise<boolean>;
  records(owner: Owner): Promise<BackOfficeRecord[]>;
  bookingExists(owner: Owner, reference: string): Promise<boolean>;
  /** The Workspace's trail, newest first. */
  trail(owner: Owner, before?: number): Promise<CallEvent[]>;

  ruleRows(owner: Owner): Promise<RuleVersionRow[]>;
  /** The Rule's next Version with its Event; null when the Rule already keeps `max`. */
  addRuleVersion(
    owner: Owner,
    edit: {
      ruleId: string;
      enabled: boolean;
      params: Record<string, unknown>;
      note: string | null;
    },
    max: number,
  ): Promise<number | null>;

  emit<T extends EventType>(
    owner: Owner,
    callId: string | null,
    actor: Actor,
    type: T,
    data: EventData[T],
  ): Promise<CallEvent<T>>;

  calls(owner: Owner): Promise<CallSummary[]>;
  call(owner: Owner, callId: string): Promise<CallView | null>;
  events(owner: Owner, callId: string, afterId?: number): Promise<CallEvent[]>;
  liveCallId(owner: Owner): Promise<string | null>;
  /** Inserts a live Call, ending the Owner's older live ones; returns their ids too. */
  open(input: NewCall): Promise<{ call: CallView; replaced: string[] }>;
  attachRun(callId: string, runId: string): Promise<void>;
  /** Marks a live Call failed (its Workflow never started). */
  fail(owner: Owner, callId: string, reason: string): Promise<void>;
  /** Ends a live Call (or cuts it off when past its grace); ending one that is over is not an error. */
  end(
    owner: Owner,
    callId: string,
    by: "caller" | "agent" | "client",
    reason?: string,
  ): Promise<CallView>;
  /** One tool call through the pure Back office, under the Call's row lock. */
  tool(input: ToolInput): Promise<ToolOutcome>;
  /** What the browser reported of a voice Call; cuts it at the spend cap. */
  report(
    owner: Owner,
    callId: string,
    events: ReportedEvent[],
  ): Promise<ReportOutcome>;
  /** A Turn an outside MCP client reports. */
  recordTurn(
    owner: Owner,
    callId: string,
    speaker: "caller" | "agent",
    text: string,
  ): Promise<"recorded" | "over" | "cut" | "full">;
  /** Adds a model call's cost to the Call; returns the Call's total. */
  addCost(owner: Owner, callId: string, usd: number): Promise<number>;
  /** Cuts a Call off if it is still live; true only for the call that cut it. */
  cutOff(owner: Owner, callId: string, reason: string): Promise<boolean>;

  /** Marks the Wrap-up running; false when there is nothing to wrap up. */
  openWrapup(owner: Owner, callId: string): Promise<boolean>;
  /** Scorecard, numbers and confirmation; returns the Callback to wait for. */
  saveWrapup(
    owner: Owner,
    callId: string,
    note: Note,
  ): Promise<{ ref: string; minutes: number } | null>;
  failWrapup(owner: Owner, callId: string, error: string): Promise<void>;
  callbackDue(
    owner: Owner,
    callId: string,
    ref: string,
    early: boolean,
  ): Promise<void>;
}

// Caps ----------------------------------------------------------------------------------

export interface SwitchboardRate {
  /** One Call (text Line) or one Turn or tool call against the visitor's hourly cap. */
  take(kind: "call" | "turn", caller: Caller): Promise<void>;
  /**
   * A voice Call: the visitor's hourly Call cap and the Owner's and
   * everyone's daily voice caps, in one transaction (ADR 0029, decision 6).
   */
  takeVoiceCall(caller: Caller): Promise<void>;
  used(visitor: Visitor): Promise<RateUse>;
}

// Paid work -----------------------------------------------------------------------------

export type AgentPart =
  | { kind: "delta"; text: string }
  /** A tool call finished: its Events go out before the next words. */
  | { kind: "tool-done" }
  /** What the model call cost, once, however the Turn ends. */
  | {
      kind: "paid";
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    };

/** The Agent on the text Line: one Caller Turn, answered. */
export interface TextAgent {
  /** The model a text Call records it was answered by. */
  readonly model: string;
  turn(input: {
    call: CallView;
    text: string;
    history: () => Promise<CallEvent[]>;
    runTool: (name: string, args: unknown, id?: string) => Promise<ToolOutcome>;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentPart>;
}

/** What opens a voice Call's realtime Session in the browser. */
export interface RealtimeSessions {
  grant(call: CallView): Promise<SessionGrantView>;
}

export type CodeResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
};

/** A Sandbox with no network: the Wrap-up's one code run. */
export interface CodeRunner {
  run(input: {
    owner: Owner;
    code: string;
    files: { path: string; content: string }[];
  }): Promise<CodeResult>;
}

/** The model that writes the Wrap-up's note, and may run code once. */
export interface NoteWriter {
  readonly model: string;
  write(
    digest: unknown,
    runCode: (code: string) => Promise<string>,
  ): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}

// The Workflow --------------------------------------------------------------------------

export interface CallLifecycles {
  /** Starts the Call's Workflow; returns its run id. */
  start(input: {
    callId: string;
    owner: Owner;
    deadlineAt: string;
  }): Promise<string>;
  /** Tells the Workflow the Call is over; a Workflow past its wait is fine. */
  wake(callId: string): Promise<void>;
  /** Wakes a waiting Callback now; false when none is waiting. */
  callbackNow(callId: string): Promise<boolean>;
}

// Access for MCP tokens -----------------------------------------------------------------

export interface TokenAccess {
  /** Signs and checks MCP tokens: rotating it revokes them. */
  secret(): string;
  hostEmails(): string[];
  /** The e2e suite is configured (its tokens stay valid only then). */
  e2e(): boolean;
  guestPass(userId: string): Promise<{
    id: string;
    expires_at: string;
    revoked_at: string | null;
    deleted_at: string | null;
  } | null>;
}

export type SwitchboardPorts = {
  store: SwitchboardStore;
  rate: SwitchboardRate;
  agent: TextAgent;
  sessions: RealtimeSessions;
  notes: NoteWriter;
  sandbox: CodeRunner;
  lifecycles: CallLifecycles;
  access: TokenAccess;
  /** Whether the Sandbox can be reached here (shown on the page). */
  sandboxConfigured: () => boolean;
  /** These are the stubbed e2e suite's services; an e2e token minted here keeps them. */
  stub: boolean;
  now: () => number;
};
