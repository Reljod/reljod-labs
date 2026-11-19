import "server-only";
import { createMCPClient, mcpAppClientCapabilities } from "@ai-sdk/mcp";
import { isStepCount, streamText, type ToolSet } from "ai";
import type { Access } from "@/features/access/server/gate";
import { type ChatEvent, cutArgs, partsOf } from "../domain/chat";
import { LIMITS } from "../domain/limits";
import { isViewPayload, VIEW_PAYLOAD_KIND } from "../domain/payload";
import { rulebookText } from "../domain/rules";
import { STUB_REPLY, stubPlan } from "../domain/stub";
import type { TrailUsage } from "../domain/trail";
import { SKILLS } from "../skills";
import type { Caller } from "./caller";
import { meridiaCatalog } from "./catalog";
import {
  conversationMessages,
  fileAnswer,
  questionSandboxMs,
} from "./conversations";
import { env } from "./env";
import { analystModel, usageOf, visibleThinking } from "./llm";
import { CANVAS_MCP_PATH, mcpHandler } from "./mcp";
import { shortToken } from "./mcp-token";
import { currentRulebook } from "./rules";
import { trail } from "./trail";
import { listViews } from "./views";

/*
 * The Analyst (ADR 0031): one agent loop. It reaches everything through the
 * Canvas MCP server, called in process with this turn's token, so its tools
 * are exactly the ones an outside client gets. The harness, not the model,
 * owns the caps: turns, USD, Sandbox time, and what counts as Verified.
 */

export type Turn = {
  access: Access;
  /** With the Conversation and the Question filed. */
  caller: Caller;
  origin: string;
  text: string;
  stub: boolean;
  signal: AbortSignal;
};

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

function turnClient(turn: Turn) {
  return createMCPClient({
    clientName: "canvas-analyst",
    capabilities: mcpAppClientCapabilities,
    transport: {
      type: "http",
      url: `${turn.origin}${CANVAS_MCP_PATH}`,
      headers: {
        authorization: `Bearer ${shortToken(turn.access, turn.caller, "chat")}`,
      },
      fetch: (url, init) => mcpHandler(new Request(url, init)),
    },
  });
}

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

async function instructions(turn: Turn) {
  const [rulebook, views] = await Promise.all([
    currentRulebook(turn.caller.owner),
    listViews(turn.caller, turn.caller.conversationId),
  ]);
  const catalog = meridiaCatalog()
    .map(
      (table) =>
        `- ${table.name} (${table.rows.toLocaleString("en")} rows; ${table.grain}): ${table.columns.map((column) => column.name).join(", ")}`,
    )
    .join("\n");
  const existing =
    views.length === 0
      ? "None yet."
      : views
          .map(
            (view) =>
              `- ${view.id}: "${view.spec.title}" (${view.spec.encoding.kind}, ${view.status}), Parameters ${JSON.stringify(view.params)}`,
          )
          .join("\n");
  return `You are the Analyst of Canvas. You answer a Question about data with a working interface: a View the person can read, check and adjust, not a paragraph of numbers.

The data is the open data of the fictional Republic of Meridia for calendar year 2025 (local time, money in Meridian crowns, MDC; southern hemisphere, so summer is December to February), in DuckDB inside a Sandbox with no network. You never see the whole data; you query it.

## How to answer
1. Look before you draw. Use describe_table for the Tables you need, then run_query with small aggregates to find the answer. Use run_code only when SQL alone is awkward.
2. Load a Skill when the task matches one (load_skill): ${SKILLS.map((skill) => `${skill.id} (${skill.description})`).join("; ")}.
3. Answer with create_view. Usually one View; two when the answer has two parts. Kinds this build draws well: line, area, bar, table, stat. Give a View a Control when changing a value is useful (a region select, a date range, a threshold slider): bind it to a Parameter and use it in the SQL as $name, so the person can change it and the Query runs again without you.
4. Every number in a Finding must be a Claim that code can recompute from the View's own rows (column, aggregate, optional where). Round in SQL and state the rounded number. A View comes back VERIFIED or FLAGGED; if FLAGGED, fix it once with create_view and \`replaces\`.
5. Then say, in two to four plain sentences, what the View shows and what to try on it. Do not repeat the table of numbers. Never state a number that is not in a Verified View.

## Limits you work within
At most ${LIMITS.turnsPerQuestion} model turns and ${LIMITS.sandboxSecondsPerQuestion} s of Sandbox time for this Question. Be economical: three to six tool calls is typical.

## The Catalog
${catalog}
The person's own Uploads, if any, show in list_tables.

## The Rules in force (Rulebook v${rulebook.version})
${rulebookText(rulebook.rulebook, rulebook.version)}
A Query that breaks a Rule is refused with the reason; change the Query, do not argue. Restricted columns may only appear inside aggregates, and small groups are dropped.

## Views already in this Conversation
${existing}`;
}

/** The e2e suite's turn: the scripted tool sequence through the same MCP client, no model. */
async function* stubTurn(
  turn: Turn,
  events: ChatEvent[],
): AsyncGenerator<ChatEvent> {
  const emit = (event: ChatEvent) => {
    events.push(event);
    return event;
  };
  const mcp = await turnClient(turn);
  try {
    for (const [index, call] of stubPlan(turn.text).entries()) {
      const id = `stub-${index}`;
      const started = Date.now();
      yield emit({
        type: "tool.started",
        id,
        name: call.name,
        args: cutArgs(call.args),
      });
      const output = await mcp.callTool({
        name: call.name,
        arguments: call.args,
      });
      yield emit({
        type: "tool.finished",
        id,
        ok: !output.isError,
        summary: summaryOf(output),
        ms: Date.now() - started,
      });
      for (const event of viewEvents(id, output)) yield emit(event);
    }
  } finally {
    await mcp.close().catch(() => {});
  }
  for (const word of STUB_REPLY.split(/(?<= )/))
    yield emit({ type: "text.delta", text: word });
}

/** The Analyst is bound by the Rules; it is never handed the tool that edits them. */
const ANALYST_DENIED_TOOL = "save_rules";

type StreamPart = { type: string } & Record<string, unknown>;

async function* modelTurn(
  turn: Turn,
  events: ChatEvent[],
  spent: { calls: TrailUsage[] },
): AsyncGenerator<ChatEvent> {
  const emit = (event: ChatEvent) => {
    events.push(event);
    return event;
  };
  const model = env.model();
  const mcp = await turnClient(turn);
  try {
    const [tools, system, history] = await Promise.all([
      // Every tool but the one that edits Rules (the server refuses it too).
      mcp.tools().then((all) => {
        const { [ANALYST_DENIED_TOOL]: _denied, ...rest } = all as Record<
          string,
          unknown
        >;
        return rest;
      }),
      instructions(turn),
      conversationMessages(turn.caller, turn.caller.conversationId as string),
    ]);
    // The Question itself is the last message on file; earlier ones are context.
    const earlier = history.slice(0, -1).slice(-12);
    const costSoFar = () =>
      spent.calls.reduce((sum, call) => sum + call.costUsd, 0);
    const result = streamText({
      model: analystModel(),
      instructions: system,
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
        yield emit({ type: "text.delta", text: String(part.text ?? "") });
      } else if (part.type === "reasoning-delta") {
        yield emit({ type: "reasoning.delta", text: String(part.text ?? "") });
      } else if (part.type === "tool-input-start") {
        const id = String(part.id ?? part.toolCallId);
        building.set(id, { name: String(part.toolName), text: "", title: "" });
        yield { type: "tool.building", id, name: String(part.toolName) };
      } else if (part.type === "tool-input-delta") {
        const id = String(part.id ?? part.toolCallId);
        const draft = building.get(id);
        if (draft?.name === "create_view") {
          draft.text += String(part.delta ?? part.inputTextDelta ?? "");
          const title = /"title"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(
            draft.text,
          )?.[1];
          if (title && title !== draft.title) {
            draft.title = title;
            yield { type: "tool.building", id, name: draft.name, title };
          }
        }
      } else if (part.type === "tool-call") {
        const id = String(part.toolCallId);
        started.set(id, Date.now());
        yield emit({
          type: "tool.started",
          id,
          name: String(part.toolName),
          args: cutArgs(part.input),
        });
      } else if (part.type === "tool-result") {
        const id = String(part.toolCallId);
        const output = part.output as ToolOutput;
        yield emit({
          type: "tool.finished",
          id,
          ok: !output?.isError,
          summary: summaryOf(output),
          ms: Date.now() - (started.get(id) ?? Date.now()),
        });
        for (const event of viewEvents(id, output)) yield emit(event);
      } else if (part.type === "tool-error") {
        const id = String(part.toolCallId);
        yield emit({
          type: "tool.finished",
          id,
          ok: false,
          summary: "The tool failed",
          ms: Date.now() - (started.get(id) ?? Date.now()),
        });
      } else if (part.type === "finish-step") {
        const usage = usageOf({
          model,
          usage: part.usage as never,
          providerMetadata: part.providerMetadata,
        });
        spent.calls.push(usage);
        await trail(turn.caller, {
          actor: "analyst",
          action: "model.called",
          summary: `Turn ${spent.calls.length}: ${usage.inputTokens} in, ${usage.outputTokens} out`,
          detail: {
            turn: spent.calls.length,
            finishReason: part.finishReason ?? null,
          },
          usage,
        });
        yield totals(model, spent.calls, 0);
      } else if (part.type === "error") {
        throw part.error instanceof Error
          ? part.error
          : new Error("The model call failed.");
      }
    }
    if (costSoFar() >= LIMITS.usdPerQuestion)
      yield emit({
        type: "notice",
        text: `Stopped at the spend cap for one Question ($${LIMITS.usdPerQuestion.toFixed(2)}).`,
      });
    else if (spent.calls.length >= LIMITS.turnsPerQuestion)
      yield emit({
        type: "notice",
        text: `Stopped at the cap of ${LIMITS.turnsPerQuestion} turns for one Question.`,
      });
  } finally {
    await mcp.close().catch(() => {});
  }
}

function totals(
  model: string,
  calls: TrailUsage[],
  sandboxMs: number,
): Extract<ChatEvent, { type: "usage" }> {
  return {
    type: "usage",
    model,
    turns: calls.length,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
    sandboxMs,
  };
}

/**
 * Answers a filed Question and yields its events as they happen. Whatever
 * ends it (an answer, a cap, Stop, an error), what was done is saved as the
 * Analyst's message and recorded on the Trail.
 */
export async function* answer(turn: Turn): AsyncGenerator<ChatEvent> {
  const events: ChatEvent[] = [];
  const spent = { calls: [] as TrailUsage[] };
  const model = turn.stub ? "stub" : env.model();
  let failed: string | null = null;
  try {
    yield* turn.stub ? stubTurn(turn, events) : modelTurn(turn, events, spent);
  } catch (error) {
    if (!turn.signal.aborted) {
      console.error(
        "[canvas] turn failed",
        error instanceof Error ? error.message : error,
      );
      failed = "The Analyst could not finish. Try the Question again.";
    }
  }
  const stopped = turn.signal.aborted;
  if (stopped) events.push({ type: "notice", text: "Stopped." });
  const usage = totals(
    model,
    spent.calls,
    await questionSandboxMs(turn.caller).catch(() => 0),
  );
  const text = events
    .filter((event) => event.type === "text.delta")
    .map((event) => event.text)
    .join("")
    .trim();
  const { type: _type, ...kept } = usage;
  const messageId = await fileAnswer(turn.caller, {
    content: text,
    parts: partsOf(events),
    usage: kept,
  }).catch(() => null);
  await trail(turn.caller, {
    action: stopped || failed ? "question.stopped" : "question.answered",
    summary: `${stopped ? "Stopped" : failed ? "Failed" : "Answered"} in ${usage.turns} turn${usage.turns === 1 ? "" : "s"}, ${events.filter((event) => event.type === "view").length} View(s), $${(usage.costUsd ?? 0).toFixed(4)}`,
    detail: {
      model,
      turns: usage.turns,
      sandboxMs: usage.sandboxMs,
      tools: events.filter((event) => event.type === "tool.started").length,
      stub: turn.stub,
      // The tokens and cost are on each turn's own `model.called` event.
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd ?? 0,
    },
  }).catch(() => {});
  yield usage;
  if (failed) yield { type: "error", message: failed };
  yield { type: "done", messageId };
}
