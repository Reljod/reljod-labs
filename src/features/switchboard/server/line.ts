import "server-only";
import { isStepCount, streamText, type ToolSet, tool } from "ai";
import type { z } from "zod";
import { callInstructions } from "../domain/agent";
import type { CallEvent } from "../domain/contract";
import { LIMITS } from "../domain/limits";
import { STUB_MODEL, TEXT_MODELS } from "../domain/models";
import { stubReply, stubTurn } from "../domain/stub";
import { BACK_OFFICE_TOOLS } from "../domain/tools";
import { gateway, gatewayCost } from "./llm";
import type { AgentPart, TextAgent } from "./ports";

/**
 * The text Line's Agent: the same instructions and Back office tools as the
 * voice Line, a Turn at a time on the server. Every tool call goes through
 * `runTool` (the Calls service, and so the Back office's Rules); the Agent
 * only decides what to say and which tool to ask for.
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

/** The language model on the text Line, through AI Gateway. */
export const modelAgent: TextAgent = {
  model: TEXT_MODELS.line,
  async *turn({ call, history, runTool, signal }) {
    const tools: ToolSet = {};
    for (const [name, spec] of Object.entries(BACK_OFFICE_TOOLS))
      tools[name] = tool({
        description: spec.description,
        inputSchema: spec.input as z.ZodType<Record<string, unknown>>,
        execute: async (args, { toolCallId }: { toolCallId: string }) =>
          (await runTool(name, args, toolCallId)).output,
      });
    const result = streamText({
      model: gateway()(call.model),
      instructions: callInstructions(call.rulebook, false),
      messages: historyOf(await history()),
      tools,
      stopWhen: isStepCount(LIMITS.stepsPerTurn),
      abortSignal: signal,
    });
    let settled = false;
    /** What the model call cost, once; null when the usage never arrived (dropped before an answer). */
    const settle = async (): Promise<AgentPart | null> => {
      if (settled) return null;
      settled = true;
      try {
        const usage = await result.totalUsage;
        return {
          kind: "paid",
          model: call.model,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          costUsd: gatewayCost(await result.providerMetadata) ?? 0,
        };
      } catch {
        return null;
      }
    };
    let said = "";
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          said += part.text;
          yield { kind: "delta", text: part.text };
        } else if (part.type === "tool-result" || part.type === "tool-error") {
          yield { kind: "tool-done" };
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
    } catch (error) {
      // A Turn that failed or was dropped mid-stream still cost what it cost.
      const paid = await settle();
      if (paid) yield paid;
      throw error;
    }
    const paid = await settle();
    if (paid) yield paid;
  },
};

/**
 * The stubbed e2e suite's Agent: canned Turns for known Caller lines
 * (`domain/stub.ts`), no model. Its tool calls still go through the real
 * Back office, its Rules and the trail, which is what the suite checks.
 */
export const cannedAgent: TextAgent = {
  model: STUB_MODEL,
  async *turn({ call, text, runTool }) {
    for (const step of stubTurn(text, call.state, call.rulebook)) {
      if (step.say) yield { kind: "delta", text: `${step.say} ` };
      if (step.tool) {
        const outcome = await runTool(step.tool.name, step.tool.args);
        yield { kind: "tool-done" };
        yield { kind: "delta", text: stubReply(outcome) };
      }
    }
  },
};
