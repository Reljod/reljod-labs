import "server-only";
import { randomUUID } from "node:crypto";
import { createMCPClient } from "@ai-sdk/mcp";
import { hasToolCall, isStepCount, streamText, type ToolSet, tool } from "ai";
import { z } from "zod";
import {
  type AssistantEvent,
  type CitedFact,
  MAX_PROPOSED_FACTS,
  type Proposal,
  type TrailStep,
  type Walk,
  type WebResult,
} from "../domain/chat";
import { citedRefs, handleOf, refOf } from "../domain/citations";
import { ROOT_KEY } from "../domain/graph";
import { env } from "./env";
import { type BookClient, findClient } from "./graph-tools";
import { gateway, gatewayCost, track } from "./llm";
import { mcpHandler } from "./mcp";
import { deskToken } from "./mcp-auth";
import { nodesByKeys } from "./repository";
import type { Visitor } from "./session";

const PROPOSE_TOOL = "propose_facts";
const WEB_TOOL = "web_search";

function instructions(input: {
  clients: BookClient[];
  scoped: BookClient | null;
  research: boolean;
}) {
  const roster = input.clients
    .slice(0, 40)
    .map(
      (client) =>
        `- ${client.name} | handle ${handleOf(client.id)} | ${client.isSample ? "sample, read-only" : "the person's own"} | ${client.nodes} facts${client.persona ? ` | ${client.persona.archetype}` : ""}`,
    )
    .join("\n");
  return `You are the client desk for a wealth manager. You know their clients only through the Client Manager tools. Never answer about a client from memory, and never guess.

${
  input.scoped
    ? `This chat is about one client: ${input.scoped.name} (handle ${handleOf(input.scoped.id)}). The tools only reach them.`
    : `This chat covers the whole book:\n${roster || "(no clients yet)"}\nWhen a question names nobody, search across everyone.`
}

How to answer:
1. Find where to start: search (with words that matter: names, products, goals), client_profile for an overview, browse_category for a whole area ("what do they own" is wealth).
2. Walk outward with expand (1 hop for direct facts, 2 for what is around), or connect for how two things relate. read_facts when you need the quotes and how sure a fact is.
3. Answer in a few short sentences or a tight list a relationship manager can use before a call. Cite every fact right after it, exactly as the tools print it, such as [[3f9a12bc/organization:santos-freight]].
4. A fact under 60% sure, or with no quote, is unconfirmed: say so in two or three words.
5. If the graph does not say, say so plainly and suggest what to ask the client.
6. Never mention tools, SQL, handles or Keys in prose; only inside [[...]] citations. Never use the em dash character.

When the person tells you something new about one of their own clients (a life event, a change, a preference), call add_facts with it in plain sentences, then say in one sentence that it is being added. Samples are read-only.

${
  input.research
    ? `Research is on. To research a client: call research_brief, then ${WEB_TOOL} two to four times with focused queries (the person's full name plus employer, company, city or role). Keep only public, professional facts you can tie to a URL and that match what the graph knows (not a namesake). Skip private matters. Then call ${PROPOSE_TOOL} with 3 to 12 findings the graph does not already hold, each one plain sentence with its URL and how sure you are. Never call add_facts with web findings: the person picks them in a card. After ${PROPOSE_TOOL}, write one short sentence at most.`
    : `Research is off. If the person asks you to look someone up on the web, tell them to switch on Research in the composer.`
}`;
}

type McpOutput = {
  content?: { type?: string; text?: string }[];
  structuredContent?: {
    traces?: { clientId: string; step: Walk["step"] }[];
    buildId?: string;
    clientId?: string;
  };
  isError?: boolean;
};

function webResults(output: unknown): WebResult[] {
  const results = (output as { results?: { url?: string; title?: string }[] })
    ?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((item) => typeof item.url === "string")
    .slice(0, 10)
    .map((item) => ({
      url: item.url as string,
      title: item.title ?? item.url ?? "",
    }));
}

/** The citations of an answer that name real Nodes of clients this chat can see. */
async function resolveCitations(
  text: string,
  clients: BookClient[],
  scoped: BookClient | null,
): Promise<CitedFact[]> {
  const byClient = new Map<string, Set<string>>();
  for (const cite of citedRefs(text)) {
    const client = cite.handle
      ? clients.find((item) => handleOf(item.id) === cite.handle)
      : scoped;
    if (!client) continue;
    const keys =
      byClient.get(client.id) ??
      byClient.set(client.id, new Set()).get(client.id);
    keys?.add(cite.key);
  }
  const resolved: CitedFact[] = [];
  for (const [clientId, keys] of byClient) {
    const client = clients.find((item) => item.id === clientId);
    if (!client) continue;
    const nodes = await nodesByKeys(clientId, [...keys]);
    for (const key of keys) {
      const node = nodes.find((item) => item.key === key);
      if (!node && key !== ROOT_KEY) continue;
      resolved.push({
        ref: refOf(clientId, key),
        clientId,
        clientName: client.name,
        key,
        label: key === ROOT_KEY ? client.name : (node?.label ?? key),
      });
    }
  }
  return resolved;
}

export type Turn = {
  text: string;
  reasoning: string;
  trail: TrailStep[];
  cited: CitedFact[];
  proposal: Proposal | null;
  buildId: string | null;
  buildClientId: string | null;
};

/**
 * One answer in a Thread. The model walks the graphs through the Client
 * Manager MCP server (in process, with a token narrowed to the Thread's
 * client), and with Research on it may search the web and propose facts.
 */
export async function* converse(input: {
  origin: string;
  sessionId: string;
  visitor: Visitor;
  clients: BookClient[];
  scopeClientId: string | null;
  research: boolean;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
}): AsyncGenerator<AssistantEvent, Turn> {
  const scoped = input.scopeClientId
    ? (input.clients.find((client) => client.id === input.scopeClientId) ??
      null)
    : null;
  const visible = scoped ? [scoped] : input.clients;
  const mcp = await createMCPClient({
    transport: {
      type: "http",
      url: `${input.origin}/api/client-manager/mcp`,
      headers: {
        authorization: `Bearer ${deskToken({
          sessionId: input.sessionId,
          visitor: input.visitor,
          clientId: scoped?.id ?? null,
        })}`,
      },
      fetch: (url, init) => mcpHandler(new Request(url, init)),
    },
  });

  const trail: TrailStep[] = [];
  // Set from inside a tool, so held in an object the compiler doesn't narrow.
  const found: { proposal: Proposal | null } = { proposal: null };
  let buildId: string | null = null;
  let buildClientId: string | null = null;
  let text = "";
  let reasoning = "";
  const model = env.chatModel();
  const started = Date.now();

  try {
    // @ai-sdk/mcp pins a newer provider-utils patch than ai; the tool shape is the same.
    const tools: ToolSet = {
      ...((await mcp.tools()) as unknown as ToolSet),
      ...(input.research
        ? {
            [WEB_TOOL]: gateway().tools.perplexitySearch({
              maxResults: 8,
              maxTokensPerPage: 1024,
              maxTokens: 10_000,
            }),
            [PROPOSE_TOOL]: tool({
              description:
                "Shows the person research findings about one client as a card where they tick which to add to the knowledge graph. Use it once, at the end of research.",
              inputSchema: z.object({
                client: z.string().describe("The client's handle or name"),
                facts: z
                  .array(
                    z.object({
                      text: z.string().max(400).describe("One plain sentence"),
                      certainty: z.enum(["high", "medium", "low"]),
                      sourceUrl: z.string().max(500),
                      sourceTitle: z.string().max(160),
                    }),
                  )
                  .min(1)
                  .max(MAX_PROPOSED_FACTS),
              }),
              execute: async (args) => {
                const client = findClient(
                  { clients: visible, visitor: input.visitor.hash },
                  args.client,
                );
                const proposal: Proposal = {
                  clientId: client.id,
                  clientName: client.name,
                  status: "open",
                  added: [],
                  buildId: null,
                  facts: args.facts
                    .filter((fact) => /^https?:\/\//i.test(fact.sourceUrl))
                    .map((fact) => ({
                      id: randomUUID().slice(0, 8),
                      text: fact.text.trim(),
                      certainty: fact.certainty,
                      sourceUrl: fact.sourceUrl,
                      sourceTitle: fact.sourceTitle || null,
                    })),
                };
                found.proposal = proposal;
                return `Shown to the person as a card with ${proposal.facts.length} findings. Wait for them to choose.`;
              },
            }),
          }
        : {}),
    };

    const result = streamText({
      model: gateway()(model),
      instructions: instructions({
        clients: input.clients,
        scoped,
        research: input.research,
      }),
      tools,
      stopWhen: [
        isStepCount(input.research ? 10 : 7),
        hasToolCall(PROPOSE_TOOL),
      ],
      reasoning: "low",
      abortSignal: input.signal,
      messages: [
        ...input.history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user" as const, content: input.question },
      ],
    });

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        yield { type: "text", delta: part.text };
      } else if (part.type === "reasoning-delta") {
        reasoning += part.text;
        yield { type: "reasoning", delta: part.text };
      } else if (part.type === "tool-call") {
        trail.push({
          callId: part.toolCallId,
          tool: part.toolName,
          input: part.input,
        });
        yield {
          type: "tool",
          callId: part.toolCallId,
          name: part.toolName,
          input: part.input,
        };
      } else if (part.type === "tool-result") {
        const step = trail.find((item) => item.callId === part.toolCallId);
        if (part.toolName === WEB_TOOL) {
          const web = webResults(part.output);
          const failed = !!(part.output as { error?: string })?.error;
          if (step)
            Object.assign(step, {
              ok: !failed,
              web,
              summary: `${web.length} results`,
            });
          yield {
            type: "tool-result",
            callId: part.toolCallId,
            ok: !failed,
            summary: `${web.length} results`,
            web,
          };
          continue;
        }
        if (part.toolName === PROPOSE_TOOL) {
          if (step) Object.assign(step, { ok: true, summary: "Shown" });
          if (found.proposal)
            yield { type: "proposal", proposal: found.proposal };
          continue;
        }
        const output = part.output as McpOutput;
        const walks: Walk[] = (output?.structuredContent?.traces ?? []).map(
          (trace) => ({ clientId: trace.clientId, step: trace.step }),
        );
        const summary =
          output?.content?.[0]?.text?.split("\n")[0]?.slice(0, 160) ?? "";
        const ok = !output?.isError;
        if (step) Object.assign(step, { ok, summary, walks });
        if (
          part.toolName === "add_facts" &&
          output?.structuredContent?.buildId
        ) {
          buildId = output.structuredContent.buildId;
          buildClientId = output.structuredContent.clientId ?? null;
          if (buildClientId)
            yield { type: "build", clientId: buildClientId, buildId };
        }
        yield {
          type: "tool-result",
          callId: part.toolCallId,
          ok,
          summary,
          walks,
        };
      } else if (part.type === "tool-error") {
        const step = trail.find((item) => item.callId === part.toolCallId);
        const summary = String(part.error).slice(0, 160);
        if (step) Object.assign(step, { ok: false, summary });
        yield {
          type: "tool-result",
          callId: part.toolCallId,
          ok: false,
          summary,
        };
      } else if (part.type === "error") {
        throw part.error instanceof Error
          ? part.error
          : new Error(String(part.error));
      }
    }

    const steps = await result.steps;
    const costs = steps.map((step) => gatewayCost(step.providerMetadata));
    const usage = await track(
      {
        clientId: scoped?.id ?? null,
        buildId: null,
        visitorHash: input.visitor.hash,
      },
      {
        purpose: "chat",
        model,
        usage: await result.usage,
        costUsd: costs.some((cost) => cost !== null)
          ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
          : null,
        started,
      },
    );
    yield { type: "usage", usage };
  } catch (error) {
    // Stopped mid-answer: keep what was said so far.
    if (!input.signal?.aborted) throw error;
  } finally {
    await mcp.close().catch(() => {});
  }

  const cited = await resolveCitations(text, input.clients, scoped);
  return {
    text,
    reasoning,
    trail,
    cited,
    proposal: found.proposal,
    buildId,
    buildClientId,
  };
}
