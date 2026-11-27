import "server-only";
import { isStepCount, streamText, type ToolSet } from "ai";
import { type ChatEvent, cutArgs } from "../domain/chat";
import { LIMITS } from "../domain/limits";
import { isViewPayload, VIEW_PAYLOAD_KIND } from "../domain/payload";
import { STUB_REPLY, stubPlan } from "../domain/stub";
import type { TrailUsage } from "../domain/trail";
import { env } from "./env";
import { analystModel, usageOf, visibleThinking } from "./llm";
import type { Analyst, AnalystTurn, McpClient } from "./ports";

/*
 * The Analyst's two adapters (ADR 0031): the model through the gateway, and
 * the e2e suite's scripted tool sequence. Both reach everything through the
 * Canvas MCP server, called in process with the turn's token, so their tools
 * are exactly the ones an outside client gets. The chat service owns what is
 * saved and capped; these only yield the turn's events.
 */

type ToolOutput = {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

const textOf = (output: unknown) =>
  (output as ToolOutput)?.content?.find((item) => item.type === "text")?.text ??
  "";

const summaryOf = (output: unknown) =>
  textOf(output)
    .split("\n")
    // A Skill opens with its front matter rule; the line after says what it is.
    .find((line) => line.trim() && line.trim() !== "---")
    ?.slice(0, 200) || "Done";

/** The View events a tool result carries: the View itself and any Linked Views run again. */
function* viewEvents(
  toolCallId: string,
  output: unknown,
): Generator<ChatEvent> {
  const structured = (output as ToolOutput)?.structuredContent;
  if (!isViewPayload(structured)) return;
  const { linked, ...payload } = structured;
  yield { type: "view", toolCallId, payload };
  for (const view of linked ?? [])
    yield {
      type: "view",
      toolCallId,
      payload: { kind: VIEW_PAYLOAD_KIND, view },
    };
}

async function* closing(
  mcp: McpClient,
  events: AsyncGenerator<ChatEvent>,
): AsyncGenerator<ChatEvent> {
  try {
    yield* events;
  } finally {
    await mcp.close().catch(() => {});
  }
}

/** The e2e suite's Analyst: the scripted tool sequence through the same MCP client, no model. */
export const scriptedAnalyst: Analyst = {
  model: () => "stub",
  async *answer(turn) {
    const mcp = await turn.connect();
    yield* closing(
      mcp,
      (async function* () {
        for (const [index, call] of stubPlan(turn.text).entries()) {
          const id = `stub-${index}`;
          const started = Date.now();
          yield {
            type: "tool.started",
            id,
            name: call.name,
            args: cutArgs(call.args),
          };
          const output = await mcp.callTool({
            name: call.name,
            arguments: call.args,
          });
          yield {
            type: "tool.finished",
            id,
            ok: !(output as ToolOutput).isError,
            summary: summaryOf(output),
            ms: Date.now() - started,
          };
          yield* viewEvents(id, output);
        }
        for (const word of STUB_REPLY.split(/(?<= )/))
          yield { type: "text.delta", text: word };
      })(),
    );
  },
};

/** The Analyst is bound by the Rules; it is never handed the tool that edits them. */
const ANALYST_DENIED_TOOL = "save_rules";

type StreamPart = { type: string } & Record<string, unknown>;

function totals(
  model: string,
  calls: TrailUsage[],
): Extract<ChatEvent, { type: "usage" }> {
  return {
    type: "usage",
    model,
    turns: calls.length,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    sandboxMs: 0,
  };
}

async function* modelTurn(
  turn: AnalystTurn,
  mcp: McpClient,
  spent: { calls: TrailUsage[] },
): AsyncGenerator<ChatEvent> {
  const model = env.model();
  const [tools, prepared] = await Promise.all([
    // Every tool but the one that edits Rules (the server refuses it too).
    mcp.tools().then((all) => {
      const { [ANALYST_DENIED_TOOL]: _denied, ...rest } = all;
      return rest;
    }),
    turn.prepare(),
  ]);
  // The Question itself is the last message on file; earlier ones are context.
  const earlier = prepared.history.slice(0, -1).slice(-12);
  const costSoFar = () =>
    spent.calls.reduce((sum, call) => sum + call.costUsd, 0);
  const result = streamText({
    model: analystModel(),
    instructions: prepared.system,
    // @ai-sdk/mcp pins a newer provider-utils patch than ai; the tool shape is the same.
    tools: tools as unknown as ToolSet,
    providerOptions: visibleThinking(model),
    maxOutputTokens: LIMITS.outputTokensPerTurn,
    // The harness ends the turn: at the turn cap, or once the USD cap is passed.
    stopWhen: [
      isStepCount(LIMITS.turnsPerQuestion),
      () => costSoFar() >= LIMITS.usdPerQuestion,
    ],
    abortSignal: turn.signal,
    messages: [
      ...earlier.map((message) => ({
        role:
          message.role === "person"
            ? ("user" as const)
            : ("assistant" as const),
        content: message.content || "(answered with Views)",
      })),
      { role: "user" as const, content: turn.text },
    ],
  });
  const started = new Map<string, number>();
  const building = new Map<
    string,
    { name: string; text: string; title: string }
  >();
  for await (const raw of result.fullStream) {
    const part = raw as StreamPart;
    if (part.type === "text-delta") {
      yield { type: "text.delta", text: String(part.text ?? "") };
    } else if (part.type === "reasoning-delta") {
      yield { type: "reasoning.delta", text: String(part.text ?? "") };
    } else if (part.type === "tool-input-start") {
      const id = String(part.id ?? part.toolCallId);
      building.set(id, { name: String(part.toolName), text: "", title: "" });
      yield { type: "tool.building", id, name: String(part.toolName) };
    } else if (part.type === "tool-input-delta") {
      const id = String(part.id ?? part.toolCallId);
      const draft = building.get(id);
      if (draft?.name === "create_view") {
        draft.text += String(part.delta ?? part.inputTextDelta ?? "");
        const title = /"title"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(draft.text)?.[1];
        if (title && title !== draft.title) {
          draft.title = title;
          yield { type: "tool.building", id, name: draft.name, title };
        }
      }
    } else if (part.type === "tool-call") {
      const id = String(part.toolCallId);
      started.set(id, Date.now());
      yield {
        type: "tool.started",
        id,
        name: String(part.toolName),
        args: cutArgs(part.input),
      };
    } else if (part.type === "tool-result") {
      const id = String(part.toolCallId);
      const output = part.output as ToolOutput;
      yield {
        type: "tool.finished",
        id,
        ok: !output?.isError,
        summary: summaryOf(output),
        ms: Date.now() - (started.get(id) ?? Date.now()),
      };
      yield* viewEvents(id, output);
    } else if (part.type === "tool-error") {
      const id = String(part.toolCallId);
      yield {
        type: "tool.finished",
        id,
        ok: false,
        summary: "The tool failed",
        ms: Date.now() - (started.get(id) ?? Date.now()),
      };
    } else if (part.type === "finish-step") {
      const usage = usageOf({
        model,
        usage: part.usage as never,
        providerMetadata: part.providerMetadata,
      });
      spent.calls.push(usage);
      await turn.onModelCall(usage, {
        turn: spent.calls.length,
        finishReason: part.finishReason ?? null,
      });
      yield totals(model, spent.calls);
    } else if (part.type === "error") {
      throw part.error instanceof Error
        ? part.error
        : new Error("The model call failed.");
    }
  }
  if (costSoFar() >= LIMITS.usdPerQuestion)
    yield {
      type: "notice",
      text: `Stopped at the spend cap for one Question ($${LIMITS.usdPerQuestion.toFixed(2)}).`,
    };
  else if (spent.calls.length >= LIMITS.turnsPerQuestion)
    yield {
      type: "notice",
      text: `Stopped at the cap of ${LIMITS.turnsPerQuestion} turns for one Question.`,
    };
}

/** The Analyst on the model gateway (`CANVAS_MODEL`). */
export const modelAnalyst: Analyst = {
  model: () => env.model(),
  async *answer(turn, spent) {
    const mcp = await turn.connect();
    yield* closing(mcp, modelTurn(turn, mcp, spent));
  },
};
