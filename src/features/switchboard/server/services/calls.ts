import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import {
  ConflictError,
  InvalidError,
  LimitError,
  NotFoundError,
} from "@/platform/errors";
import { textGreeting } from "../../domain/agent";
import type {
  CallResponse,
  ReportResponse,
  StartCallResponse,
} from "../../domain/api";
import {
  type CallEvent,
  type CallSummary,
  type Line,
  type ReportedEvent,
  reportedEventSchema,
  type Scenario,
  type TurnStreamPart,
} from "../../domain/contract";
import { detectLanguage } from "../../domain/hearing";
import { LIMITS } from "../../domain/limits";
import { DEFAULT_REALTIME_MODEL, realtimeModel } from "../../domain/models";
import { sampleCaller } from "../../domain/samples";
import { normalizeReference } from "../../domain/world";
import { isUuid } from "../db";
import type {
  AgentPart,
  Caller,
  SwitchboardPorts,
  ToolOutcome,
} from "../ports";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export type StartInput = {
  line: Line;
  origin: "app" | "mcp";
  model?: string;
  scenario: Scenario;
};

export type ToolRequest = {
  toolCallId: string;
  name: string;
  args: unknown;
  saying?: string;
  hearing?: string;
};

/**
 * The life of a Call, the same for the voice Line, the text Line and an
 * outside MCP client: start, tool calls through the Back office, what was
 * said, the end. The server owns the clock, the caps and the Rules; the
 * model and the browser own neither. Every cap is taken before the paid
 * step it guards (the Session's secret, the model's Turn).
 */
export interface CallsService {
  list(owner: Owner): Promise<CallSummary[]>;
  get(owner: Owner, callId: string, afterId?: number): Promise<CallResponse>;
  /** Starts a Call (ending any live one): the voice Line answers with its Session, the text Line with the greeting said. */
  start(caller: Caller, input: StartInput): Promise<StartCallResponse>;
  end(
    caller: Caller,
    callId: string,
    by: "caller" | "agent" | "client",
    reason?: string,
  ): Promise<CallResponse>;
  /** One tool call through the Back office, which alone decides. */
  tool(
    caller: Caller,
    callId: string,
    request: ToolRequest,
  ): Promise<ToolOutcome>;
  /** What the browser heard and measured in a voice Call. */
  report(
    caller: Caller,
    callId: string,
    events: unknown[],
  ): Promise<ReportResponse>;
  /**
   * One Caller Turn on the text Line. Resolves once every refusal is past
   * (the cap, a Call that is over); then the Agent's answer streams.
   */
  turn(
    caller: Caller,
    callId: string,
    text: string,
    via: "text" | "mcp",
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<TurnStreamPart>>;
  /** A Turn an outside MCP client, as the Agent, reports. */
  recordTurn(
    caller: Caller,
    callId: string,
    speaker: "caller" | "agent",
    text: string,
  ): Promise<void>;
  /** Wakes the Call's Workflow from its Callback sleep now. */
  callbackNow(owner: Owner, callId: string): Promise<void>;
  /** The Call named, or the Owner's live one. */
  callIdFor(owner: Owner, callId?: string): Promise<string>;
}

export function createCallsService(ports: SwitchboardPorts): CallsService {
  const { store, rate, agent, sessions, lifecycles } = ports;

  async function load(owner: Owner, callId: string, afterId = 0) {
    if (!isUuid(callId)) throw new NotFoundError("No such Call.");
    const [call, events] = await Promise.all([
      store.call(owner, callId),
      store.events(owner, callId, afterId),
    ]);
    if (!call) throw new NotFoundError("No such Call.");
    return { call, events };
  }

  async function end(
    caller: Caller,
    callId: string,
    by: "caller" | "agent" | "client",
    reason?: string,
  ) {
    const call = await store.end(caller.owner, callId, by, reason);
    const [events] = await Promise.all([
      store.events(caller.owner, callId),
      lifecycles.wake(callId),
    ]);
    return { call, events };
  }

  async function tool(caller: Caller, callId: string, request: ToolRequest) {
    if (!isUuid(callId)) throw new NotFoundError("No such Call.");
    await rate.take("turn", caller);
    const outcome = await store.tool({
      owner: caller.owner,
      callId,
      toolCallId: request.toolCallId,
      name: request.name,
      args: request.args,
      saying: request.saying,
      hearing: request.hearing,
    });
    if (outcome.over === "cut_off") await lifecycles.wake(callId);
    return outcome;
  }

  /** The Agent's answer to one Caller Turn, after `turn` has passed every check. */
  async function* answer(
    caller: Caller,
    call: StartCallResponse["call"],
    text: string,
    via: "text" | "mcp",
    signal?: AbortSignal,
  ): AsyncGenerator<TurnStreamPart> {
    const { owner } = caller;
    const started = ports.now();
    const atMs = () => ports.now() - Date.parse(call.startedAt);

    yield {
      kind: "event",
      event: await store.emit(owner, call.id, "caller", "turn.caller", {
        text,
        language: detectLanguage(text),
        via,
        atMs: atMs(),
      }),
    };

    const pending: CallEvent[] = [];
    let toolMs = 0;
    let said = "";
    let firstWordMs: number | null = null;
    let toolSeq = 0;
    const runTool = async (name: string, args: unknown, id?: string) => {
      const before = ports.now();
      const outcome = await tool(caller, call.id, {
        toolCallId: id ?? `text-${started}-${++toolSeq}`,
        name,
        args,
        saying: said,
        hearing: text,
      });
      toolMs += ports.now() - before;
      pending.push(...outcome.events);
      return outcome;
    };
    /** Books a model call's cost and cuts the Call off at its spend cap. */
    const book = async (paid: Extract<AgentPart, { kind: "paid" }>) => {
      const event = await store.emit(owner, call.id, "system", "model.call", {
        purpose: "turn",
        model: paid.model,
        inputTokens: paid.inputTokens,
        outputTokens: paid.outputTokens,
        costUsd: paid.costUsd,
        ms: ports.now() - started,
      });
      const total = await store.addCost(owner, call.id, paid.costUsd);
      if (
        total >= LIMITS.usdPerCall &&
        (await store.cutOff(
          owner,
          call.id,
          `The Call reached its spend cap of $${LIMITS.usdPerCall.toFixed(2)}.`,
        ))
      )
        await lifecycles.wake(call.id);
      return event;
    };

    try {
      for await (const part of agent.turn({
        call,
        text,
        history: () => store.events(owner, call.id),
        runTool,
        signal,
      })) {
        if (part.kind === "delta") {
          firstWordMs ??= ports.now() - started;
          said += part.text;
          yield { kind: "delta", text: part.text };
        } else if (part.kind === "tool-done") {
          for (const event of pending.splice(0)) yield { kind: "event", event };
        } else {
          yield { kind: "event", event: await book(part) };
        }
      }
    } catch (error) {
      // A Turn that failed or was dropped mid-stream still cost what it cost
      // (the Agent yields `paid` before it rethrows).
      for (const event of pending.splice(0)) yield { kind: "event", event };
      if (!said.trim()) {
        console.error("[switchboard] text Turn failed", messageOf(error));
        yield {
          kind: "error",
          message: "The Agent could not answer. Try that again.",
        };
        yield { kind: "done" };
        return;
      }
    }

    for (const event of pending.splice(0)) yield { kind: "event", event };
    if (said.trim())
      yield {
        kind: "event",
        event: await store.emit(owner, call.id, "agent", "turn.agent", {
          text: said.trim().slice(0, LIMITS.transcriptChars),
          language: detectLanguage(said),
          atMs: atMs(),
          interrupted: false,
          latency: {
            firstAudioMs: firstWordMs ?? ports.now() - started,
            ...(toolMs ? { toolMs } : {}),
          },
        }),
      };
    const after = await store.call(owner, call.id);
    if (after) yield { kind: "call", call: after };
    yield { kind: "done" };
  }

  return {
    list: (owner) => store.calls(owner),

    get: load,

    async start(caller, input) {
      const { owner } = caller;
      const model =
        input.line === "voice"
          ? (realtimeModel(input.model ?? "")?.id ?? DEFAULT_REALTIME_MODEL)
          : agent.model;
      if (
        input.scenario.kind === "sample" &&
        !sampleCaller(input.scenario.sampleId)
      )
        throw new InvalidError("No such Sample caller.");
      // A typo in the Booking costs nothing: check it before taking the rate.
      if (
        input.scenario.kind === "own" &&
        !(await store.bookingExists(
          owner,
          normalizeReference(input.scenario.bookingRef),
        ))
      )
        throw new InvalidError("No such Booking in the Back office.");
      // Before any Session exists: the voice caps bound what a day can cost (ADR 0029).
      if (input.line === "voice") await rate.takeVoiceCall(caller);
      else await rate.take("call", caller);

      const { call, replaced } = await store.open({
        owner,
        line: input.line,
        origin: input.origin,
        model,
        scenario: input.scenario,
        consentAudio: false,
      });
      await Promise.all(replaced.map((id) => lifecycles.wake(id)));
      try {
        const runId = await lifecycles.start({
          callId: call.id,
          owner,
          deadlineAt: call.deadlineAt,
        });
        await store.attachRun(call.id, runId);
      } catch (error) {
        // Without its Workflow a Call has no server-side cut-off and no Wrap-up: do not run it.
        await store.fail(
          owner,
          call.id,
          "The Call's Workflow could not start.",
        );
        console.error("[switchboard] workflow start failed", messageOf(error));
        throw new ConflictError(
          "The Call could not start. Try again in a moment.",
        );
      }

      let session: StartCallResponse["session"] = null;
      if (call.line === "voice") {
        try {
          session = await sessions.grant(call);
        } catch (error) {
          console.error("[switchboard] session mint failed", messageOf(error));
          await end(caller, call.id, "client", "The Session could not open.");
          throw new ConflictError(
            "The voice Line could not open. Try the text Line, or try again.",
          );
        }
      } else {
        const greeting = textGreeting(call.rulebook);
        await store.emit(owner, call.id, "agent", "turn.agent", {
          text: greeting,
          language: detectLanguage(greeting),
          atMs: 0,
          interrupted: false,
        });
      }
      return { call, events: await store.events(owner, call.id), session };
    },

    end,

    tool,

    async report(caller, callId, events) {
      const parsed: ReportedEvent[] = [];
      for (const event of events.slice(0, LIMITS.eventsPerRequest)) {
        const one = reportedEventSchema.safeParse(event);
        if (one.success) parsed.push(one.data);
      }
      const result = await store.report(caller.owner, callId, parsed);
      if (result.cut) await lifecycles.wake(callId);
      return {
        accepted: result.accepted,
        status: result.status,
        costUsd: result.costUsd,
      };
    },

    async turn(caller, callId, input, via, signal) {
      const text = input.trim().slice(0, LIMITS.turnChars);
      if (!text) throw new InvalidError("Say something first.");
      if (!isUuid(callId)) throw new NotFoundError("No such Call.");
      await rate.take("turn", caller);
      const call = await store.call(caller.owner, callId);
      if (!call) throw new NotFoundError("No such Call.");
      if (call.status !== "live")
        throw new ConflictError("That Call is over. Start a new one.");
      // Past its deadline the Call is only waiting to be cut off: no model call.
      if (ports.now() >= Date.parse(call.deadlineAt))
        throw new ConflictError(
          "That Call has reached its longest length. Hang up to see the wrap-up.",
        );
      if (call.line !== "text")
        throw new ConflictError(
          "That Call is on the voice Line: type into its Session instead.",
        );
      return answer(caller, call, text, via, signal);
    },

    async recordTurn(caller, callId, speaker, text) {
      if (!isUuid(callId)) throw new NotFoundError("No such Call.");
      await rate.take("turn", caller);
      const outcome = await store.recordTurn(
        caller.owner,
        callId,
        speaker,
        text,
      );
      if (outcome === "full")
        throw new LimitError("This Call has reached its Event limit.");
      if (outcome === "cut") await lifecycles.wake(callId);
      if (outcome !== "recorded") throw new ConflictError("That Call is over.");
    },

    async callbackNow(owner, callId) {
      if (!isUuid(callId) || !(await store.call(owner, callId)))
        throw new NotFoundError("No such Call.");
      if (!(await lifecycles.callbackNow(callId)))
        throw new ConflictError("That Callback is no longer waiting.");
    },

    async callIdFor(owner, callId) {
      if (callId) return callId;
      const live = await store.liveCallId(owner);
      if (!live)
        throw new ConflictError("No Call is live. Start one with start_call.");
      return live;
    },
  };
}
