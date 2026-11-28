import "server-only";
import { createMCPClient } from "@ai-sdk/mcp";
import { isStepCount, streamText, type ToolSet, tool } from "ai";
import { z } from "zod";
import { attachedNote } from "../domain/attachments";
import type { AuditUsage } from "../domain/audit";
import type { ChatEvent } from "../domain/chat-events";
import {
  cardEventsOf,
  cutArgs,
  instructionsFor,
  type SkillIndexEntry,
  stubReplyOf,
  stubToolCallOf,
  toolOk,
  toolSummaryOf,
  webSummaryOf,
} from "../domain/chat-turn";
import { LIMITS } from "../domain/limits";
import { HARNESS_MCP_PATH } from "../domain/mcp-tools";
import { bankToday } from "../domain/pipelines/dates";
import { renderSkillMd } from "../domain/skills";
import { env } from "./env";
import { addUsage, chatModel, gateway, usageOf, visibleThinking } from "./llm";
import { chatToken } from "./mcp-auth";
import type { AgentTurn, Attachment, AuditLog, ChatAgent } from "./ports";
import type { SkillService } from "./services/skills";

/*
 * The Agent of a chat turn (ADR 0013), as the Chat service's `ChatAgent`.
 * It reaches the Workspace only through the Harness MCP server, called in
 * process with a ten-minute token for the Session's Staff member and the
 * Session; its only local tools are web search (a Connector of its own) and
 * `load_skill`. The e2e suite's agent calls one MCP tool the same way and
 * gives a canned reply, with no model.
 */

const LOAD_SKILL = "load_skill";
const WEB_SEARCH = "web_search";

export type AgentDeps = {
  skills: Pick<SkillService, "list" | "find">;
  attachments: (
    owner: AgentTurn["caller"]["owner"],
    sessionId: string,
  ) => Promise<Attachment[]>;
  audit: AuditLog;
  /** The Harness MCP server, called in process for this container's services. */
  mcp: (request: Request) => Promise<Response>;
};

/** The Harness MCP server, called in process with this turn's token (ADR 0013). */
function turnMcpClient(turn: AgentTurn, deps: AgentDeps) {
  const { caller } = turn;
  return createMCPClient({
    transport: {
      type: "http",
      url: `${turn.origin}${HARNESS_MCP_PATH}`,
      headers: {
        authorization: `Bearer ${chatToken({
          access: caller.access,
          owner: caller.owner,
          staff: caller.staff,
          visitor: caller.visitor,
          sessionId: turn.session.id,
        })}`,
      },
      fetch: (url, init) => deps.mcp(new Request(url, init)),
    },
  });
}

/** The bank's day (Cayman), not the server's UTC date. */
const today = () => bankToday();

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

/** The chat model, with the Harness MCP server's tools, web search and `load_skill`. */
export function modelAgent(deps: AgentDeps): ChatAgent {
  return {
    async *answer(turn, signal) {
      const { caller } = turn;
      const { owner, staff } = caller;
      const sessionId = turn.session.id;
      const model = env.chatModel();
      // The MCP client and its tool list are fetched alongside the reads
      // below: each is a round trip, and the model call waits for all.
      const opening = turnMcpClient(turn, deps);
      const listing = opening.then((client) => client.tools());
      let ready: [
        SkillIndexEntry[],
        Attachment[],
        Awaited<typeof opening>,
        Awaited<typeof listing>,
      ];
      try {
        ready = await Promise.all([
          deps.skills.list(caller).then((skills) =>
            skills.map((skill) => ({
              id: skill.id,
              name: skill.name,
              description: skill.description,
              kind: skill.kind,
            })),
          ),
          // Everything attached in this Session, from the database, so a
          // later turn still knows each paper's id (list_sources never
          // shows unfiled ones).
          deps.attachments(owner, sessionId),
          opening,
          listing,
        ]);
      } catch (error) {
        void opening.then((client) => client.close()).catch(() => {});
        throw error;
      }
      const [skills, attached, mcp, mcpTools] = ready;
      const note = attachedNote(
        turn.attached.map((source) => ({
          type: "attachment",
          sourceId: source.sourceId,
          name: source.title,
          kind: source.kind,
        })),
      );
      /** Skills loaded this turn, by tool call. */
      const loaded = new Map<string, { skillId: string; name: string }>();
      let toolCalls = 0;

      try {
        // @ai-sdk/mcp pins a newer provider-utils patch than ai; the tool shape is the same.
        const tools: ToolSet = {
          ...(mcpTools as unknown as ToolSet),
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
              const skill = await deps.skills.find(caller, skillId);
              if (!skill) return `There is no Skill "${skillId}".`;
              loaded.set(toolCallId, { skillId: skill.id, name: skill.name });
              await deps.audit.record({
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
          }),
          tools,
          // Show the model's thinking as it happens (`reasoning.delta`).
          providerOptions: visibleThinking(model),
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
            yield { type: "text.delta", text: part.text };
          } else if (part.type === "reasoning-delta") {
            yield { type: "reasoning.delta", text: part.text };
          } else if (part.type === "tool-call") {
            const cut = cutArgs(part.input);
            args.set(part.toolCallId, cut);
            toolCalls += 1;
            yield {
              type: "tool.started",
              id: part.toolCallId,
              name: part.toolName,
              args: cut,
            };
          } else if (part.type === "tool-result") {
            if (part.toolName === WEB_SEARCH) {
              const web = webSummaryOf(part.output);
              await deps.audit.record({
                owner,
                sessionId,
                actor: { kind: "agent" },
                action: "web.searched",
                summary: `Searched the web: ${web.summary}`,
                detail: { args: args.get(part.toolCallId) ?? {}, ...web },
              });
              yield {
                type: "tool.finished",
                id: part.toolCallId,
                ok: web.ok,
                summary: web.summary,
              };
              continue;
            }
            if (part.toolName === LOAD_SKILL) {
              const skill = loaded.get(part.toolCallId);
              yield {
                type: "tool.finished",
                id: part.toolCallId,
                ok: !!skill,
                summary: skill ? `Loaded ${skill.name}` : "No such Skill",
              };
              if (skill) yield { type: "skill.loaded", ...skill };
              continue;
            }
            yield {
              type: "tool.finished",
              id: part.toolCallId,
              ok: toolOk(part.output),
              summary: toolSummaryOf(part.output),
            };
            for (const card of cardEventsOf(part.output)) yield card;
          } else if (part.type === "tool-error") {
            yield {
              type: "tool.finished",
              id: part.toolCallId,
              ok: false,
              summary: "The tool failed",
            };
          } else if (part.type === "error") {
            throw part.error instanceof Error
              ? part.error
              : new Error("The model call failed.");
          }
        }

        // Recorded even when stopped: the steps that ran were paid for.
        const usage = await turnUsage(result, model).catch(() => null);
        if (usage) {
          yield { type: "usage", ...usage };
          await deps.audit.record({
            owner,
            sessionId,
            actor: { kind: "agent" },
            action: "model.called",
            summary: `Answered with ${usage.model}`,
            detail: { staff: staff.name, tools: toolCalls },
            usage,
          });
        }
        return { usage };
      } finally {
        await mcp.close().catch(() => {});
      }
    },
  };
}

/**
 * The e2e suite's Agent: the same events and saves, no model. It calls one
 * Harness MCP tool chosen by `stubToolCallOf` through the same in-process
 * client a real turn uses (so a Run card, a Source card and the Audit trail
 * are real), then gives a canned reply.
 */
export function stubAgent(deps: AgentDeps): ChatAgent {
  return {
    async *answer(turn) {
      const { caller } = turn;
      // A follow-up that names "the attached paper" without attaching it
      // again takes the Session's unfiled attachments, as the real Agent
      // would find them.
      const attached =
        turn.attached.length === 0 && /\battached\b/i.test(turn.text)
          ? (await deps.attachments(caller.owner, turn.session.id))
              .filter((item) => item.status === "pending")
              .slice(0, 1)
          : turn.attached;
      const plan = stubToolCallOf(turn.text, attached, today());
      let called = "";
      if (plan) {
        const mcp = await turnMcpClient(turn, deps);
        try {
          const tools = (await mcp.tools()) as unknown as ToolSet;
          const chosen = tools[plan.name];
          if (chosen?.execute) {
            const id = `stub-${crypto.randomUUID()}`;
            yield {
              type: "tool.started",
              id,
              name: plan.name,
              args: cutArgs(plan.args),
            } satisfies ChatEvent;
            // MCP tools take their arguments as JSON; the schema is checked by the server.
            const execute = chosen.execute as unknown as (
              args: Record<string, unknown>,
              options: { toolCallId: string; messages: [] },
            ) => Promise<unknown>;
            const output = await execute(plan.args, {
              toolCallId: id,
              messages: [],
            });
            yield {
              type: "tool.finished",
              id,
              ok: toolOk(output),
              summary: toolSummaryOf(output),
            };
            for (const card of cardEventsOf(output)) yield card;
            called = ` Called ${plan.name}: ${toolSummaryOf(output)}`;
          }
        } finally {
          await mcp.close().catch(() => {});
        }
      }
      const reply = `${stubReplyOf(turn.text, turn.attached.length)}${called}`;
      for (const word of reply.split(/(?<= )/)) {
        yield { type: "text.delta", text: word };
      }
      yield {
        type: "usage",
        model: "stub",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
      return { usage: null };
    },
  };
}
