import "server-only";
import { isStepCount, streamText, type ToolSet, tool } from "ai";
import { z } from "zod";
import { BRANCHES, categoryLabel } from "../domain/categories";
import { citedKeys } from "../domain/citations";
import type { ChatEvent, ToolName, TraversalStep } from "../domain/events";
import { ROOT_KEY } from "../domain/graph";
import { env } from "./env";
import { type CallContext, gateway, gatewayCost, track } from "./llm";
import { embedTexts } from "./persona";
import {
  categoryCounts,
  connectNodes,
  edgesAmong,
  edgesByIds,
  evidenceForNodes,
  expandNodes,
  type GraphNodeRow,
  nodesByKeys,
  nodesInCategory,
  searchNodes,
} from "./repository";

export type TraceEntry = { step: TraversalStep; sql: string; ms: number };

const MAX_STEPS = 7;

function line(node: GraphNodeRow, extra = "") {
  const attributes = Object.entries(node.attributes ?? {})
    .slice(0, 8)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return `${node.key} | ${node.label} | ${node.category}${extra} | ${node.summary}${attributes ? ` | ${attributes}` : ""}`;
}

const edgeKeyOf = (edge: {
  from_key: string;
  relation: string;
  to_key: string;
}) => `${edge.from_key}|${edge.relation}|${edge.to_key}`;

const quoteSql = (value: string) =>
  `'${value.replace(/'/g, "''").slice(0, 60)}'`;

/** A push queue the tools and the text stream both write to, read as one stream. */
function channel<T>() {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(item: T) {
      items.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *drain(): AsyncGenerator<T> {
      for (;;) {
        while (items.length > 0) yield items.shift() as T;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    },
  };
}

function instructions(clientName: string, map: string) {
  return `You are the Navigator for a wealth manager. You answer questions about one client, ${clientName}, by walking their Client graph in Postgres, and only from what you find there.

The graph: the client is the Node "client". Every other Node sits in one Category (branch.leaf) and is joined to others by Edges such as MARRIED_TO or HOLDS. What each Category holds right now:
${map}

How to answer:
1. Find where to start: search_graph with the words that matter (names, products, goals), or browse_category when the question is about a whole area ("what does she own" → wealth).
2. Walk outward with expand (1 hop for direct facts, 2 for "who/what around"), or connect when the question is how two things relate.
3. read the Nodes you will rely on, to see their attributes and the quotes they stand on.
4. Answer in a few short sentences or a tight list, in plain words a relationship manager can use before a call. Cite every fact with the Node it came from, written [[key]] right after the fact, such as "She sold Santos Freight in 2024 [[organization:santos-freight]]."
5. If the graph doesn't say, say so plainly and suggest what to ask the client. Never invent names, numbers or dates.

Be quick: usually 2 to 4 tool calls. Never mention tools, SQL or Keys in prose; only in [[key]] citations.`;
}

export async function* navigate(input: {
  context: CallContext;
  clientId: string;
  clientName: string;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  /**
   * Starts an addition Build from facts the person just shared. Absent when
   * this session may not add to the client (a Sample, someone else's client).
   */
  onRecord?: (facts: string) => Promise<string>;
}): AsyncGenerator<
  ChatEvent,
  {
    text: string;
    reasoning: string;
    trace: TraceEntry[];
    cited: string[];
    buildId: string | null;
  }
> {
  const { clientId, context } = input;
  const events = channel<ChatEvent>();
  const trace: TraceEntry[] = [];
  let buildId: string | null = null;
  let currentCall: string | undefined;

  const record = (step: TraversalStep, sql: string, started: number) => {
    const entry = { step, sql, ms: Date.now() - started };
    trace.push(entry);
    events.push({ type: "step", callId: currentCall, ...entry });
  };

  /** Every tool call shows as running in the transcript, then as its result. */
  function traced<I>(name: ToolName, run: (input: I) => Promise<string>) {
    return async (args: I, options: { toolCallId: string }) => {
      currentCall = options.toolCallId;
      events.push({
        type: "tool",
        callId: options.toolCallId,
        name,
        input: args,
      });
      try {
        const result = await run(args);
        events.push({
          type: "tool-result",
          callId: options.toolCallId,
          ok: true,
          summary: result.split("\n")[0]?.slice(0, 140) ?? "",
        });
        return result;
      } catch (error) {
        events.push({
          type: "tool-result",
          callId: options.toolCallId,
          ok: false,
          summary: error instanceof Error ? error.message : "failed",
        });
        return "That tool failed. Answer with what you have.";
      }
    };
  }

  const counts = await categoryCounts(clientId);
  const map = BRANCHES.map((branch) => {
    const leaves = branch.leaves
      .map((leaf) => {
        const total =
          counts.find((row) => row.category === `${branch.id}.${leaf.id}`)
            ?.total ?? 0;
        return total > 0 ? `${branch.id}.${leaf.id} (${total})` : null;
      })
      .filter(Boolean);
    return `- ${branch.label}: ${leaves.length > 0 ? leaves.join(", ") : "empty"}`;
  }).join("\n");

  const tools = {
    search_graph: tool({
      description:
        "Find the Nodes most related to some words, by meaning (pgvector) and by exact terms (full text). Returns up to 8 Nodes to start from.",
      inputSchema: z.object({
        query: z.string().describe("A few words: names, things, topics"),
      }),
      execute: traced("search_graph", async ({ query }) => {
        const started = Date.now();
        const { embeddings, usage } = await embedTexts(context, [query]).catch(
          () => ({
            embeddings: [] as number[][],
            usage: null,
          }),
        );
        if (usage) events.push({ type: "usage", usage });
        const hits = await searchNodes(
          clientId,
          query,
          embeddings[0] ?? null,
          8,
        );
        record(
          {
            kind: "search",
            query,
            hits: hits.map((hit) => ({
              key: hit.key,
              score: Number(hit.score.toFixed(4)),
            })),
          },
          `select * from client_manager.search_nodes(client, ${quoteSql(query)}, embed(${quoteSql(query)}), 8);\n-- pgvector cosine (<=>) fused with tsvector rank`,
          started,
        );
        return hits.length === 0
          ? "No Nodes matched. Try other words or browse_category."
          : hits.map((hit) => line(hit)).join("\n");
      }),
    }),
    expand: tool({
      description:
        "Walk the graph outward from some Nodes, both ways along Edges, up to 1 to 3 hops (pgRouting pgr_drivingDistance). Returns every Node reached, its distance, and the Edges among them.",
      inputSchema: z.object({
        keys: z.array(z.string()).min(1).max(6).describe("Keys to start from"),
        hops: z.number().int().min(1).max(3),
      }),
      execute: traced("expand", async ({ keys, hops }) => {
        const started = Date.now();
        const seeds = await nodesByKeys(clientId, keys);
        if (seeds.length === 0)
          return "None of those Keys exist. Use search_graph first.";
        const reached = await expandNodes(
          clientId,
          seeds.map((seed) => seed.id),
          hops,
          45,
        );
        const byId = new Map(reached.map((node) => [node.id, node]));
        for (const seed of seeds) {
          if (!byId.has(seed.id))
            byId.set(seed.id, { ...seed, depth: 0, edge_id: null });
        }
        const viaEdges = await edgesByIds(
          clientId,
          [...byId.values()].flatMap((node) =>
            node.edge_id ? [node.edge_id] : [],
          ),
        );
        const viaKey = new Map(
          viaEdges.map((edge) => [edge.id, edgeKeyOf(edge)]),
        );
        const nodes = [...byId.values()].sort((a, b) => a.depth - b.depth);
        record(
          {
            kind: "expand",
            from: seeds.map((seed) => seed.key),
            hops,
            reached: nodes.map((node) => ({
              key: node.key,
              depth: node.depth,
              via: node.edge_id ? (viaKey.get(node.edge_id) ?? null) : null,
            })),
          },
          `select * from pgr_drivingDistance(\n  'select id, source_id as source, target_id as target, 1 as cost, 1 as reverse_cost\n     from client_manager.edges where client_id = …',\n  array[${seeds.map((seed) => seed.id).join(", ")}], ${hops}, directed => false, equicost => true);`,
          started,
        );
        const edges = await edgesAmong(
          clientId,
          nodes.map((node) => node.id),
        );
        return [
          "Nodes (key | label | category | depth | summary | attributes):",
          ...nodes.map((node) => line(node, ` | depth ${node.depth}`)),
          "Edges:",
          ...edges
            .slice(0, 80)
            .map(
              (edge) =>
                `${edge.from_key} -${edge.relation}-> ${edge.to_key} (${edge.label})`,
            ),
        ].join("\n");
      }),
    }),
    connect: tool({
      description:
        "Find how two Nodes are connected: the best-supported path between them (pgRouting pgr_dijkstra, cheaper along Edges read with more confidence).",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: traced("connect", async ({ from, to }) => {
        const started = Date.now();
        const ends = await nodesByKeys(clientId, [from, to]);
        const start = ends.find((node) => node.key === from);
        const end = ends.find((node) => node.key === to);
        if (!start || !end)
          return "One of those Keys does not exist. Use search_graph first.";
        const path = await connectNodes(clientId, start.id, end.id);
        const edges = await edgesByIds(
          clientId,
          path.flatMap((step) => (step.edge_id ? [step.edge_id] : [])),
        );
        record(
          {
            kind: "path",
            from,
            to,
            nodes: path.map((step) => step.key),
            edges: edges.map(edgeKeyOf),
          },
          `select * from pgr_dijkstra(\n  'select id, source_id as source, target_id as target, 1.5 - confidence * 0.5 as cost, …\n     from client_manager.edges where client_id = …',\n  ${start.id}, ${end.id}, directed => false);`,
          started,
        );
        if (path.length === 0) return `No path between ${from} and ${to}.`;
        return edges
          .map(
            (edge) =>
              `${edge.from_key} -${edge.relation}-> ${edge.to_key} (${edge.label})`,
          )
          .join("\n");
      }),
    }),
    browse_category: tool({
      description:
        "List the Nodes in one Category: a branch such as 'wealth' or a leaf such as 'wealth.accounts'.",
      inputSchema: z.object({ category: z.string() }),
      execute: traced("browse_category", async ({ category }) => {
        const started = Date.now();
        const nodes = await nodesInCategory(
          clientId,
          category.trim().toLowerCase(),
        );
        record(
          { kind: "category", category, keys: nodes.map((node) => node.key) },
          category.includes(".")
            ? `select * from client_manager.nodes where client_id = … and category = ${quoteSql(category)};`
            : `select * from client_manager.nodes where client_id = … and split_part(category, '.', 1) = ${quoteSql(category)};`,
          started,
        );
        if (nodes.length === 0) {
          const { branch, leaf } = categoryLabel(category);
          return `Nothing under ${branch}${leaf ? ` › ${leaf}` : ""}.`;
        }
        return nodes.map((node) => line(node)).join("\n");
      }),
    }),
    read: tool({
      description:
        "Read Nodes in full: attributes, and the exact quotes from the Sources they stand on.",
      inputSchema: z.object({ keys: z.array(z.string()).min(1).max(10) }),
      execute: traced("read", async ({ keys }) => {
        const started = Date.now();
        const nodes = await nodesByKeys(clientId, keys);
        const evidence = await evidenceForNodes(
          clientId,
          nodes.map((node) => node.id),
        );
        record(
          { kind: "read", keys: nodes.map((node) => node.key) },
          `select n.*, v.quote, s.name from client_manager.nodes n\n  join client_manager.evidence v on v.node_id = n.id\n  join client_manager.sources s on s.id = v.source_id\n where n.key = any(array[${nodes.map((node) => quoteSql(node.key)).join(", ")}]);`,
          started,
        );
        return nodes
          .map((node) => {
            const quotes = evidence
              .filter((item) => item.node_id === node.id && item.quote)
              .slice(0, 4)
              .map((item) => `  "${item.quote}" (${item.source_name})`);
            return [line(node), ...quotes].join("\n");
          })
          .join("\n");
      }),
    }),
  };
  const onRecord = input.onRecord;
  const recordTool: ToolSet = onRecord
    ? {
        record_facts: tool({
          description:
            "Add new information the person just told you about the client to the graph. Starts the same pipeline as the Intake (extract, check, critique, repair, commit) in the background. Use it only for new facts, never for questions.",
          inputSchema: z.object({
            facts: z
              .string()
              .describe(
                "The new facts, written out in full sentences, as the person said them",
              ),
          }),
          execute: traced("record_facts", async ({ facts }) => {
            if (buildId) return "Already recording this message's facts.";
            buildId = await onRecord(facts);
            events.push({ type: "build", buildId });
            return `Recording: the graph is being updated with "${facts.slice(0, 80)}${facts.length > 80 ? "…" : ""}"`;
          }),
        }),
      }
    : {};

  const model = env.chatModel();
  const started = Date.now();
  let text = "";
  let reasoning = "";
  const result = streamText({
    model: gateway()(model),
    instructions: `${instructions(input.clientName, map)}${
      onRecord
        ? "\n\nWhen the person tells you something new about the client (a life event, a change, a preference, a new account), call record_facts with it, then say in one short sentence that you're adding it. If they also ask a question, answer it from the graph as usual."
        : "\n\nThis client is read-only here: if the person tells you new facts, say they can't be added to a Sample client."
    }`,
    tools: { ...tools, ...recordTool },
    stopWhen: isStepCount(MAX_STEPS),
    reasoning: "low",
    messages: [
      ...input.history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      { role: "user" as const, content: input.question },
    ],
  });

  const pump = (async () => {
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          text += part.text;
          events.push({ type: "text", delta: part.text });
        } else if (part.type === "reasoning-delta") {
          reasoning += part.text;
          events.push({ type: "reasoning", delta: part.text });
        }
      }
    } finally {
      events.close();
    }
  })();

  for await (const event of events.drain()) yield event;
  await pump;

  const steps = await result.steps;
  const costs = steps.map((step) => gatewayCost(step.providerMetadata));
  const usage = await track(context, {
    purpose: "chat",
    model,
    usage: await result.usage,
    costUsd: costs.some((cost) => cost !== null)
      ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
      : null,
    started,
  });
  yield { type: "usage", usage };

  const known = new Set(
    trace.flatMap(({ step }) => {
      switch (step.kind) {
        case "search":
          return step.hits.map((hit) => hit.key);
        case "expand":
          return step.reached.map((node) => node.key);
        case "path":
          return step.nodes;
        default:
          return step.keys;
      }
    }),
  );
  known.add(ROOT_KEY);
  const cited = citedKeys(text).filter((key) => known.has(key));
  return { text, reasoning, trace, cited, buildId };
}
