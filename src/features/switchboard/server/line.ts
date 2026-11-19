import "server-only";
import { isStepCount, streamText, type ToolSet, tool } from "ai";
import type { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import { callInstructions, textGreeting } from "../domain/agent";
import { NEW_CALL_STATE } from "../domain/backoffice";
import type { CallEvent, TurnStreamPart } from "../domain/contract";
import { detectLanguage } from "../domain/hearing";
import { LIMITS } from "../domain/limits";
import { STUB_MODEL } from "../domain/models";
import { stubReply, stubTurn } from "../domain/stub";
import { BACK_OFFICE_TOOLS } from "../domain/tools";
import { callTool, cutOffForSpend } from "./calls";
import { isUuid, sql } from "./db";
import { InvalidError, messageOf, NotFoundError, StateError } from "./errors";
import { gateway, gatewayCost } from "./llm";
import { takeRate, type Visitor } from "./rate";
import { callEvents, callRow, emit, toCall } from "./store";

/**
 * The text Line: the same Agent, the same instructions and the same Back
 * office as the voice Line, a Turn at a time on the server with a language
 * model. It is how a visitor without a microphone, an outside MCP client and
 * the end-to-end test hold a Call.
 */

type Message = { role: "user" | "assistant"; content: string };

/** The Call so far as a conversation. Tool results ride along as notes, so a later Turn remembers them. */
function historyOf(events: CallEvent[]): Message[] {
  const out: Message[] = [];
  const push = (role: Message["role"], content: string) => {
    const last = out.at(-1);
    if (last?.role === role) last.content += `\n${content}`;
    else out.push({ role, content });
  };
  for (const event of events) {
    if (event.type === "turn.caller") push("user", event.data.text);
    else if (event.type === "turn.agent") push("assistant", event.data.text);
    else if (event.type === "tool.result")
      push(
        "assistant",
        `[Back office, ${event.data.name}: ${JSON.stringify(event.data.output).slice(0, 1500)}]`,
      );
  }
  // A model's conversation starts with the Caller.
  if (out[0]?.role === "assistant")
    out.unshift({ role: "user", content: "(the line connects)" });
  return out;
}

/** Opens the text Line: the Agent's greeting, said by code. */
export async function greet(owner: Owner, callId: string) {
  const row = await callRow(owner, callId);
  if (!row) throw new NotFoundError("No such Call.");
  const text = textGreeting(row.rulebook);
  return emit(sql(), owner, callId, "agent", "turn.agent", {
    text,
    language: detectLanguage(text),
    atMs: 0,
    interrupted: false,
  });
}

/**
 * One Caller Turn on the text Line and the Agent's answer, streamed. With
 * `stub` the model is replaced by canned Turns (`domain/stub.ts`); the tool
 * calls are real either way.
 */
export async function* takeTurn(input: {
  owner: Owner;
  who: Visitor;
  callId: string;
  text: string;
  via: "text" | "mcp";
  signal?: AbortSignal;
}): AsyncGenerator<TurnStreamPart> {
  const text = input.text.trim().slice(0, LIMITS.turnChars);
  if (!text) throw new InvalidError("Say something first.");
  if (!isUuid(input.callId)) throw new NotFoundError("No such Call.");
  await takeRate(input.who, input.owner, "turn");
  const row = await callRow(input.owner, input.callId);
  if (!row) throw new NotFoundError("No such Call.");
  if (row.status !== "live")
    throw new StateError("That Call is over. Start a new one.");
  if (row.line !== "text")
    throw new StateError(
      "That Call is on the voice Line: type into its Session instead.",
    );
  const started = Date.now();
  const atMs = () => Date.now() - row.started_at.getTime();

  yield {
    kind: "event",
    event: await emit(sql(), input.owner, row.id, "caller", "turn.caller", {
      text,
      language: detectLanguage(text),
      via: input.via,
      atMs: atMs(),
    }),
  };

  const pending: CallEvent[] = [];
  let toolMs = 0;
  let said = "";
  let firstWordMs: number | null = null;
  let toolSeq = 0;
  /** Books the model call's cost, once, however the Turn ends. */
  let settle: (() => Promise<CallEvent | null>) | null = null;
  const runTool = async (name: string, args: unknown, id?: string) => {
    const before = Date.now();
    const outcome = await callTool({
      owner: input.owner,
      who: input.who,
      callId: row.id,
      toolCallId: id ?? `text-${started}-${++toolSeq}`,
      name,
      args,
      saying: said,
      hearing: text,
    });
    toolMs += Date.now() - before;
    pending.push(...outcome.events);
    return outcome;
  };

  try {
    if (row.model === STUB_MODEL) {
      const state = { ...NEW_CALL_STATE, ...row.state };
      for (const step of stubTurn(text, state, row.rulebook)) {
        if (step.say) {
          firstWordMs ??= Date.now() - started;
          said += `${said ? " " : ""}${step.say}`;
          yield { kind: "delta", text: `${step.say} ` };
        }
        if (step.tool) {
          const outcome = await runTool(step.tool.name, step.tool.args);
          for (const event of pending.splice(0)) yield { kind: "event", event };
          const reply = stubReply(outcome);
          firstWordMs ??= Date.now() - started;
          said += `${said ? " " : ""}${reply}`;
          yield { kind: "delta", text: reply };
        }
      }
    } else {
      const tools: ToolSet = {};
      for (const [name, spec] of Object.entries(BACK_OFFICE_TOOLS))
        tools[name] = tool({
          description: spec.description,
          inputSchema: spec.input as z.ZodType<Record<string, unknown>>,
          execute: async (args, { toolCallId }: { toolCallId: string }) =>
            (await runTool(name, args, toolCallId)).output,
        });
      const events = await callEvents(input.owner, row.id);
      const result = streamText({
        model: gateway()(row.model),
        instructions: callInstructions(row.rulebook, false),
        messages: historyOf(events),
        tools,
        stopWhen: isStepCount(LIMITS.stepsPerTurn),
        abortSignal: input.signal,
      });
      settle = async () => {
        settle = null;
        try {
          const usage = await result.totalUsage;
          const costUsd = gatewayCost(await result.providerMetadata) ?? 0;
          const event = await emit(
            sql(),
            input.owner,
            row.id,
            "system",
            "model.call",
            {
              purpose: "turn",
              model: row.model,
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              costUsd,
              ms: Date.now() - started,
            },
          );
          const [spent] = await sql()<{ cost_usd: string }[]>`
            update switchboard.calls set cost_usd = cost_usd + ${costUsd.toFixed(6)}
            where id = ${row.id} and owner = ${input.owner}
            returning cost_usd`;
          if (Number(spent?.cost_usd ?? 0) >= LIMITS.usdPerCall)
            await cutOffForSpend(input.owner, row.id);
          return event;
        } catch {
          // The usage never arrived (the request was dropped before the model answered).
          return null;
        }
      };
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          firstWordMs ??= Date.now() - started;
          said += part.text;
          yield { kind: "delta", text: part.text };
        } else if (part.type === "tool-result" || part.type === "tool-error") {
          for (const event of pending.splice(0)) yield { kind: "event", event };
          // The next words are a new sentence.
          if (said && !/\s$/.test(said)) {
            said += " ";
            yield { kind: "delta", text: " " };
          }
        } else if (part.type === "error") {
          throw part.error instanceof Error
            ? part.error
            : new Error(String(part.error));
        }
      }
      const paid = await settle?.();
      if (paid) yield { kind: "event", event: paid };
    }
  } catch (error) {
    // A Turn that failed or was dropped mid-stream still cost what it cost.
    const paid = await settle?.();
    if (paid) yield { kind: "event", event: paid };
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
      event: await emit(sql(), input.owner, row.id, "agent", "turn.agent", {
        text: said.trim().slice(0, LIMITS.transcriptChars),
        language: detectLanguage(said),
        atMs: atMs(),
        interrupted: false,
        latency: {
          firstAudioMs: firstWordMs ?? Date.now() - started,
          ...(toolMs ? { toolMs } : {}),
        },
      }),
    };
  const after = await callRow(input.owner, row.id);
  if (after) yield { kind: "call", call: toCall(after) };
  yield { kind: "done" };
}
