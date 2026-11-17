import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import { isStepCount, streamText, type ToolSet, tool } from "ai";
import { z } from "zod";
import { attachedNote } from "../domain/attachments";
import type { AuditUsage } from "../domain/audit";
import type { ChatEvent } from "../domain/chat-events";
import {
  type AttachmentNote,
  cardEventsOf,
  cutArgs,
  historyOf,
  instructionsFor,
  partsOf,
  type SkillIndexEntry,
  stubReplyOf,
  stubToolCallOf,
  toolOk,
  toolSummaryOf,
  webSummaryOf,
} from "../domain/chat-turn";
import { LIMITS } from "../domain/limits";
import { HARNESS_MCP_PATH } from "../domain/mcp-tools";
import { can } from "../domain/permissions";
import { bankToday } from "../domain/pipelines/dates";
import type { MessagePart, SessionSummary } from "../domain/session";
import { renderSkillMd } from "../domain/skills";
import { sessionAttachments } from "./attachments";
import { audit } from "./audit";
import type { StaffContext } from "./context";
import { env } from "./env";
import { InvalidError } from "./errors";
import { listSources } from "./knowledge";
import { addUsage, chatModel, gateway, usageOf } from "./llm";
import { mcpHandler } from "./mcp";
import { chatToken } from "./mcp-auth";
import { appendMessage, listMessages, writableSession } from "./sessions";
import { getSkill, listSkills } from "./skills";

/*
 * One chat turn (ADR 0013). The Agent reaches the Workspace only through the
 * Harness MCP server, called in process with a ten-minute token for the
 * Session's Staff member and the Session; its only local tools are web search
 * (a Connector of its own) and `load_skill`.
 */

const LOAD_SKILL = "load_skill";
const WEB_SEARCH = "web_search";

/** Attachments one message may carry. */
export const MAX_ATTACHMENTS = 10;

export type ChatTurnInput = {
  context: StaffContext;
  sessionId: string;
  text: string;
  attachments: string[];
  origin: string;
  /** e2e only: a canned reply, no model spend. */
  stubbed: boolean;
};

/** A turn whose Staff message is saved, ready to stream the Agent's answer. */
export type PreparedTurn = ChatTurnInput & {
  session: SessionSummary;
  /** The Session's title changed with this message. */
  renamed: boolean;
  history: { role: "user" | "assistant"; content: string }[];
  attached: AttachmentNote[];
};

/** The attached Sources that are the Owner's; anything else is dropped. */
async function attachedSources(
  context: StaffContext,
  ids: string[],
): Promise<(AttachmentNote & { bytes: number })[]> {
  if (ids.length === 0) return [];
  const sources = await listSources(context.owner);
  return ids.flatMap((id) => {
    const source = sources.find((item) => item.id === id);
    return source
      ? [
          {
            sourceId: source.id,
            title: source.title,
            kind: source.kind,
            status: source.status,
            bytes: source.bytes,
          },
        ]
      : [];
  });
}

/**
 * Everything before the stream: the Session must be the Staff member's own,
 * the attachments the Owner's, and the Staff message passes the caps
 * (`appendMessage` holds the length and the hourly limit). Throws the errors
 * the route answers with `failure()`.
 */
export async function prepareTurn(input: ChatTurnInput): Promise<PreparedTurn> {
  const { context } = input;
  if (input.attachments.length > MAX_ATTACHMENTS) {
    throw new InvalidError(
      `A message carries at most ${MAX_ATTACHMENTS} attachments.`,
    );
  }
  const before = await writableSession(context, input.sessionId);
  const [earlier, attached] = await Promise.all([
    listMessages(context.owner, before.id),
    attachedSources(context, [...new Set(input.attachments)]),
  ]);
  const parts: MessagePart[] = attached.map((source) => ({
    type: "attachment",
    sourceId: source.sourceId,
    name: source.title,
    kind: source.kind,
    bytes: source.bytes,
  }));
  const { session } = await appendMessage({
    role: "staff",
    owner: context.owner,
    staff: context.staff,
    visitor: context.visitor,
    sessionId: before.id,
    content: input.text,
    parts,
  });
  return {
    ...input,
    session,
    renamed: session.title !== before.title,
    history: historyOf(earlier),
    attached: attached.map(({ bytes: _bytes, ...note }) => note),
  };
}

/** The Skill index for the instructions. */
async function skillIndex(context: StaffContext): Promise<SkillIndexEntry[]> {
  return (await listSkills(context.owner)).map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    kind: skill.kind,
  }));
}

/** The bank's day (Cayman), not the server's UTC date. */
const today = () => bankToday();

/** Saves the Agent's message and ends the stream with `done`. */
async function finish(
  turn: PreparedTurn,
  content: string,
  events: ChatEvent[],
  usage: AuditUsage | null,
): Promise<ChatEvent> {
  const { message } = await appendMessage({
    role: "agent",
    owner: turn.context.owner,
    sessionId: turn.session.id,
    content,
    parts: partsOf(events),
    usage,
  });
  return { type: "done", messageId: message.id };
}

/** The Harness MCP server, called in process with this turn's token (ADR 0013). */
function turnMcpClient(turn: PreparedTurn) {
  const { context } = turn;
  return createMCPClient({
    transport: {
      type: "http",
      url: `${turn.origin}${HARNESS_MCP_PATH}`,
      headers: {
        authorization: `Bearer ${chatToken({
          access: context.access,
          owner: context.owner,
          staff: context.staff,
          visitor: context.visitor,
          sessionId: turn.session.id,
        })}`,
      },
      fetch: (url, init) => mcpHandler(new Request(url, init)),
    },
  });
}

/**
 * The e2e suite's turn: the same events and saves, no model. It calls one
 * Harness MCP tool chosen by `stubToolCallOf` through the same in-process
 * client a real turn uses (so a Run card, a Source card and the Audit trail
 * are real), then gives a canned reply.
 */
async function* stubTurn(turn: PreparedTurn): AsyncGenerator<ChatEvent> {
  const events: ChatEvent[] = [];
  const emit = (event: ChatEvent) => {
    events.push(event);
    return event;
  };
  // A follow-up that names "the attached paper" without attaching it again
  // takes the Session's unfiled attachments, as the real Agent would find them.
  const attached =
    turn.attached.length === 0 && /\battached\b/i.test(turn.text)
      ? (await sessionAttachments(turn.context.owner, turn.session.id))
          .filter((item) => item.status === "pending")
          .slice(0, 1)
      : turn.attached;
  const plan = stubToolCallOf(turn.text, attached, today());
  let called = "";
  if (plan) {
    const mcp = await turnMcpClient(turn);
    try {
      const tools = (await mcp.tools()) as unknown as ToolSet;
      const chosen = tools[plan.name];
      if (chosen?.execute) {
        const id = `stub-${crypto.randomUUID()}`;
        yield emit({
          type: "tool.started",
          id,
          name: plan.name,
          args: cutArgs(plan.args),
        });
        // MCP tools take their arguments as JSON; the schema is checked by the server.
        const execute = chosen.execute as unknown as (
          args: Record<string, unknown>,
          options: { toolCallId: string; messages: [] },
        ) => Promise<unknown>;
        const output = await execute(plan.args, {
          toolCallId: id,
          messages: [],
        });
        yield emit({
          type: "tool.finished",
          id,
          ok: toolOk(output),
          summary: toolSummaryOf(output),
        });
        for (const card of cardEventsOf(output)) yield emit(card);
        called = ` Called ${plan.name}: ${toolSummaryOf(output)}`;
      }
    } finally {
      await mcp.close().catch(() => {});
    }
  }
  const reply = `${stubReplyOf(turn.text, turn.attached.length)}${called}`;
  for (const word of reply.split(/(?<= )/)) {
    yield emit({ type: "text.delta", text: word });
  }
  yield {
    type: "usage",
    model: "stub",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };
  yield await finish(turn, reply, events, null);
}

/**
 * The Agent's answer to a prepared turn, as ChatEvents. Ends with `done`, or
 * throws (the route turns that into an `error` event). Stopped by the
 * client: what was said so far is saved, marked stopped.
 */
export async function* streamTurn(
  turn: PreparedTurn,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  if (turn.renamed) yield { type: "session", session: turn.session };
  if (turn.stubbed) {
    yield* stubTurn(turn);
    return;
  }

  const { context } = turn;
  const { owner, staff } = context;
  const sessionId = turn.session.id;
  const model = env.chatModel();
  const [skills, attached] = await Promise.all([
    skillIndex(context),
    // Everything attached in this Session, from the database, so a later
    // turn still knows each paper's id (list_sources never shows unfiled ones).
    sessionAttachments(owner, sessionId),
  ]);
  const note = attachedNote(
    turn.attached.map((source) => ({
      type: "attachment",
      sourceId: source.sourceId,
      name: source.title,
      kind: source.kind,
    })),
  );

  const mcp = await turnMcpClient(turn);

  const events: ChatEvent[] = [];
  const emit = (event: ChatEvent) => {
    events.push(event);
    return event;
  };
  /** Skills loaded this turn, by tool call. */
  const loaded = new Map<string, { skillId: string; name: string }>();
  let text = "";
  let aborted = false;

  try {
    // @ai-sdk/mcp pins a newer provider-utils patch than ai; the tool shape is the same.
    const tools: ToolSet = {
      ...((await mcp.tools()) as unknown as ToolSet),
      [WEB_SEARCH]: gateway().tools.perplexitySearch({
        maxResults: 6,
        maxTokensPerPage: 1024,
        maxTokens: 8_000,
      }),
      [LOAD_SKILL]: tool({
        description:
          "Loads one of the desk's Skills (by the id in your instructions) and returns its full SKILL.md. Load a Skill before a task it describes.",
        inputSchema: z.object({ skillId: z.string().min(1).max(120) }),
        execute: async ({ skillId }, { toolCallId }) => {
          const skill =
            (await getSkill(owner, skillId)) ??
            (await listSkills(owner)).find((item) => item.name === skillId) ??
            null;
          if (!skill) return `There is no Skill "${skillId}".`;
          loaded.set(toolCallId, { skillId: skill.id, name: skill.name });
          await audit({
            owner,
            sessionId,
            actor: { kind: "agent" },
            action: "skill.loaded",
            summary: `Loaded the ${skill.name} Skill`,
            target: { kind: "skill", id: skill.id },
            detail: { version: skill.version, staff: staff.name },
          });
          return renderSkillMd(skill);
        },
      }),
    };

    const result = streamText({
      model: chatModel(),
      instructions: instructionsFor({
        staff,
        today: today(),
        skills,
        attachments: attached,
        sandbox: can(staff, "sandbox.use"),
      }),
      tools,
      stopWhen: isStepCount(LIMITS.stepsPerChatTurn),
      abortSignal: signal,
      messages: [
        ...turn.history,
        {
          role: "user" as const,
          content: note ? `${turn.text}\n\n${note}` : turn.text,
        },
      ],
    });

    const args = new Map<string, Record<string, unknown>>();
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        yield emit({ type: "text.delta", text: part.text });
      } else if (part.type === "reasoning-delta") {
        yield emit({ type: "reasoning.delta", text: part.text });
      } else if (part.type === "tool-call") {
        const cut = cutArgs(part.input);
        args.set(part.toolCallId, cut);
        yield emit({
          type: "tool.started",
          id: part.toolCallId,
          name: part.toolName,
          args: cut,
        });
      } else if (part.type === "tool-result") {
        if (part.toolName === WEB_SEARCH) {
          const web = webSummaryOf(part.output);
          await audit({
            owner,
            sessionId,
            actor: { kind: "agent" },
            action: "web.searched",
            summary: `Searched the web: ${web.summary}`,
            detail: { args: args.get(part.toolCallId) ?? {}, ...web },
          });
          yield emit({
            type: "tool.finished",
            id: part.toolCallId,
            ok: web.ok,
            summary: web.summary,
          });
          continue;
        }
        if (part.toolName === LOAD_SKILL) {
          const skill = loaded.get(part.toolCallId);
          yield emit({
            type: "tool.finished",
            id: part.toolCallId,
            ok: !!skill,
            summary: skill ? `Loaded ${skill.name}` : "No such Skill",
          });
          if (skill) yield emit({ type: "skill.loaded", ...skill });
          continue;
        }
        yield emit({
          type: "tool.finished",
          id: part.toolCallId,
          ok: toolOk(part.output),
          summary: toolSummaryOf(part.output),
        });
        for (const card of cardEventsOf(part.output)) yield emit(card);
      } else if (part.type === "tool-error") {
        yield emit({
          type: "tool.finished",
          id: part.toolCallId,
          ok: false,
          summary: "The tool failed",
        });
      } else if (part.type === "abort") {
        aborted = true;
      } else if (part.type === "error") {
        throw part.error instanceof Error
          ? part.error
          : new Error("The model call failed.");
      }
    }

    // Recorded even when stopped: the steps that ran were paid for.
    const usage = await turnUsage(result, model).catch(() => null);
    if (usage) {
      yield emit({ type: "usage", ...usage });
      await audit({
        owner,
        sessionId,
        actor: { kind: "agent" },
        action: "model.called",
        summary: `Answered with ${usage.model}`,
        detail: {
          staff: staff.name,
          tools: events.filter((event) => event.type === "tool.started").length,
        },
        usage,
      });
    }
    yield await finish(
      turn,
      aborted ? `${text.trim()} (stopped)`.trim() : text.trim(),
      events,
      usage,
    );
  } catch (error) {
    if (!signal.aborted) throw error;
    // Stopped mid-answer: keep what was said so far.
    await finish(turn, `${text.trim()} (stopped)`.trim(), events, null).catch(
      () => null,
    );
  } finally {
    await mcp.close().catch(() => {});
  }
}

/** What the turn's model calls cost, step by step. */
async function turnUsage(
  result: {
    steps: PromiseLike<
      {
        usage?: Parameters<typeof usageOf>[0]["usage"];
        providerMetadata?: unknown;
      }[]
    >;
  },
  model: string,
): Promise<AuditUsage | null> {
  const steps = await result.steps;
  return addUsage(
    steps.map((step) =>
      usageOf({
        model,
        usage: step.usage,
        providerMetadata: step.providerMetadata,
      }),
    ),
  );
}
