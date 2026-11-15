import "server-only";
import { BRANCHES, categoryLabel } from "../domain/categories";
import { handleOf, refOf } from "../domain/citations";
import { certaintyOf } from "../domain/confidence";
import type { Persona, TraversalStep } from "../domain/events";
import { ROOT_KEY } from "../domain/graph";
import { embedTexts } from "./persona";
import {
  type CatalogRow,
  categoryCounts,
  connectNodes,
  edgesAmong,
  edgesByIds,
  edgesInScope,
  evidenceForNodes,
  expandNodes,
  factsPerSource,
  type GraphNodeRow,
  nodesByKeys,
  nodesInCategory,
  searchNodes,
  sourceDetail,
  sourcesOfClient,
  usageSince,
} from "./repository";
import { LIMITS } from "./service";

/**
 * What the Client Manager MCP server can do with the graphs, as plain
 * functions: every one answers in lines a model reads, and the walks also
 * return the Traversal the app draws. Clients are addressed by id, Handle or
 * name; Nodes by Key; facts are cited as `[[handle/key]]`.
 */

export type BookClient = {
  id: string;
  name: string;
  isSample: boolean;
  owner: string | null;
  status: CatalogRow["status"];
  persona: Persona | null;
  nodes: number;
  edges: number;
};

/** The clients a token reaches: every visible one, or the one it is scoped to. */
export type Book = { clients: BookClient[]; visitor: string };

export type Trace = {
  clientId: string;
  step: TraversalStep;
  sql: string;
  ms: number;
};

export type Outcome = {
  text: string;
  data?: Record<string, unknown>;
  traces?: Trace[];
};

export class ToolError extends Error {}

const quoteSql = (value: string) =>
  `'${value.replace(/'/g, "''").slice(0, 60)}'`;

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function bookOf(
  rows: CatalogRow[],
  visitor: string,
  only?: string | null,
): Book {
  return {
    visitor,
    clients: rows
      .filter((row) => !only || row.id === only)
      .map((row) => ({
        id: row.id,
        name: row.name,
        isSample: row.is_sample,
        owner: row.owner,
        status: row.status,
        persona: row.persona,
        nodes: row.node_count,
        edges: row.edge_count,
      })),
  };
}

/** A client by id, Handle or name. With one client in the book, it is the default. */
export function findClient(book: Book, ref?: string | null): BookClient {
  const wanted = (ref ?? "").trim().toLowerCase();
  if (!wanted) {
    if (book.clients.length === 1 && book.clients[0]) return book.clients[0];
    throw new ToolError(
      "Name the client: an id, a handle or a name from list_clients.",
    );
  }
  const exact =
    book.clients.find((client) => client.id === wanted) ??
    book.clients.find((client) => handleOf(client.id) === wanted) ??
    book.clients.find((client) => client.name.toLowerCase() === wanted);
  if (exact) return exact;
  const partial = book.clients.filter((client) =>
    client.name.toLowerCase().includes(wanted),
  );
  if (partial.length === 1 && partial[0]) return partial[0];
  throw new ToolError(
    partial.length > 1
      ? `"${ref}" matches ${partial.map((client) => client.name).join(", ")}. Be more specific.`
      : `No client "${ref}" here. Call list_clients.`,
  );
}

function line(clientId: string, node: GraphNodeRow, extra = "") {
  const attributes = Object.entries(node.attributes ?? {})
    .slice(0, 8)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return `[[${refOf(clientId, node.key)}]] | ${node.label} | ${node.category}${extra} | ${percent(node.confidence ?? 0.5)} sure | ${node.summary}${attributes ? ` | ${attributes}` : ""}`;
}

const edgeKeyOf = (edge: {
  from_key: string;
  relation: string;
  to_key: string;
}) => `${edge.from_key}|${edge.relation}|${edge.to_key}`;

const edgeLine = (edge: {
  from_key: string;
  relation: string;
  to_key: string;
  label: string;
  confidence?: number;
}) =>
  `${edge.from_key} -${edge.relation}-> ${edge.to_key} (${edge.label}${edge.confidence !== undefined ? `, ${percent(edge.confidence)} sure` : ""})`;

// Reading the book --------------------------------------------------------------

export function listClients(book: Book, query?: string): Outcome {
  const needle = query?.trim().toLowerCase() ?? "";
  const clients = book.clients.filter(
    (client) =>
      !needle ||
      [client.name, client.persona?.archetype, client.persona?.headline]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle)),
  );
  return {
    text:
      clients.length === 0
        ? "No clients match."
        : clients
            .map(
              (client) =>
                `${client.name} | id ${client.id} | handle ${handleOf(client.id)} | ${client.isSample ? "sample, read-only" : "yours"} | ${client.nodes} facts${client.persona ? ` | ${client.persona.archetype}: ${client.persona.headline}` : ""}${client.status === "building" ? " | still building" : ""}`,
            )
            .join("\n"),
    data: {
      clients: clients.map((client) => ({
        id: client.id,
        handle: handleOf(client.id),
        name: client.name,
        sample: client.isSample,
        facts: client.nodes,
        archetype: client.persona?.archetype ?? null,
      })),
    },
  };
}

async function categoryMap(clientId: string) {
  const counts = await categoryCounts(clientId);
  return BRANCHES.map((branch) => {
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
}

export async function clientProfile(client: BookClient): Promise<Outcome> {
  const started = Date.now();
  const [map, edges] = await Promise.all([
    categoryMap(client.id),
    edgesInScope(client.id, { kind: "root" }),
  ]);
  const direct = edges.slice(0, 40);
  const keys = [
    ...new Set(
      direct.map((edge) =>
        edge.from_key === ROOT_KEY ? edge.to_key : edge.from_key,
      ),
    ),
  ];
  const persona = client.persona;
  return {
    text: [
      `${client.name} (handle ${handleOf(client.id)}, cite the client as [[${refOf(client.id, ROOT_KEY)}]])`,
      persona
        ? `Persona: ${persona.archetype}. ${persona.headline} Risk appetite ${persona.riskAppetite}. Communication: ${persona.communication} Traits: ${persona.traits.join(", ")}.`
        : "No persona yet.",
      "What the graph holds, by Category:",
      map,
      "Direct relations of the client:",
      ...direct.map(edgeLine),
    ].join("\n"),
    traces: [
      {
        clientId: client.id,
        step: { kind: "read", keys: [ROOT_KEY, ...keys.slice(0, 12)] },
        sql: "select … from client_manager.edges where source or target is the client;",
        ms: Date.now() - started,
      },
    ],
  };
}

/** The daily budget check for the cheap calls a search makes (one embedding). */
async function canEmbed(visitor: string) {
  if (visitor === "e2e") return true;
  const day = await usageSince(visitor, new Date(Date.now() - 86_400_000));
  return day.cost < LIMITS.spendPerVisitorPerDay;
}

export async function search(
  book: Book,
  query: string,
  clientRef?: string | null,
): Promise<Outcome> {
  const started = Date.now();
  const clients = clientRef
    ? [findClient(book, clientRef)]
    : book.clients.filter((client) => client.nodes > 1).slice(0, 25);
  if (clients.length === 0) return { text: "There are no clients to search." };
  const context = { clientId: null, buildId: null, visitorHash: book.visitor };
  const embedding = (await canEmbed(book.visitor))
    ? ((await embedTexts(context, [query]).catch(() => null))?.embeddings[0] ??
      null)
    : null;
  const perClient = await Promise.all(
    clients.map(async (client) => ({
      client,
      hits: await searchNodes(
        client.id,
        query,
        embedding,
        clients.length > 1 ? 5 : 8,
      ),
    })),
  );
  const ms = Date.now() - started;
  const merged = perClient
    .flatMap(({ client, hits }) => hits.map((hit) => ({ client, hit })))
    .sort((a, b) => b.hit.score - a.hit.score)
    .slice(0, clients.length > 1 ? 12 : 8);
  return {
    text:
      merged.length === 0
        ? "Nothing matched. Try other words, or browse_category."
        : merged
            .map(
              ({ client, hit }) =>
                `${clients.length > 1 ? `${client.name}: ` : ""}${line(client.id, hit)}`,
            )
            .join("\n"),
    traces: perClient
      .filter(({ hits }) => hits.length > 0)
      .map(({ client, hits }) => ({
        clientId: client.id,
        step: {
          kind: "search" as const,
          query,
          hits: hits.map((hit) => ({
            key: hit.key,
            score: Number(hit.score.toFixed(4)),
          })),
        },
        sql: `select * from client_manager.search_nodes(client, ${quoteSql(query)}, embed(${quoteSql(query)}), 8);\n-- pgvector cosine (<=>) fused with tsvector rank`,
        ms,
      })),
  };
}

export async function expand(
  client: BookClient,
  keys: string[],
  hops: number,
): Promise<Outcome> {
  const started = Date.now();
  const seeds = await nodesByKeys(client.id, keys);
  if (seeds.length === 0)
    throw new ToolError("None of those Keys exist. Use search first.");
  const reached = await expandNodes(
    client.id,
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
    client.id,
    [...byId.values()].flatMap((node) => (node.edge_id ? [node.edge_id] : [])),
  );
  const viaKey = new Map(viaEdges.map((edge) => [edge.id, edgeKeyOf(edge)]));
  const nodes = [...byId.values()].sort((a, b) => a.depth - b.depth);
  const edges = await edgesAmong(
    client.id,
    nodes.map((node) => node.id),
  );
  return {
    text: [
      "Facts reached (ref | label | category | depth | confidence | summary | attributes):",
      ...nodes.map((node) => line(client.id, node, ` | depth ${node.depth}`)),
      "Relations among them:",
      ...edges.slice(0, 80).map(edgeLine),
    ].join("\n"),
    traces: [
      {
        clientId: client.id,
        step: {
          kind: "expand",
          from: seeds.map((seed) => seed.key),
          hops,
          reached: nodes.map((node) => ({
            key: node.key,
            depth: node.depth,
            via: node.edge_id ? (viaKey.get(node.edge_id) ?? null) : null,
          })),
        },
        sql: `select * from pgr_drivingDistance(\n  'select id, source_id as source, target_id as target, 1 as cost, 1 as reverse_cost\n     from client_manager.edges where client_id = …',\n  array[${seeds.map((seed) => seed.id).join(", ")}], ${hops}, directed => false, equicost => true);`,
        ms: Date.now() - started,
      },
    ],
  };
}

export async function connect(
  client: BookClient,
  from: string,
  to: string,
): Promise<Outcome> {
  const started = Date.now();
  const ends = await nodesByKeys(client.id, [from, to]);
  const start = ends.find((node) => node.key === from);
  const end = ends.find((node) => node.key === to);
  if (!start || !end)
    throw new ToolError("One of those Keys does not exist. Use search first.");
  const path = await connectNodes(client.id, start.id, end.id);
  const edges = await edgesByIds(
    client.id,
    path.flatMap((step) => (step.edge_id ? [step.edge_id] : [])),
  );
  return {
    text:
      path.length === 0
        ? `No path between ${from} and ${to}.`
        : edges.map(edgeLine).join("\n"),
    traces: [
      {
        clientId: client.id,
        step: {
          kind: "path",
          from,
          to,
          nodes: path.map((step) => step.key),
          edges: edges.map(edgeKeyOf),
        },
        sql: `select * from pgr_dijkstra(\n  'select id, source_id as source, target_id as target, 1.5 - confidence * 0.5 as cost, …\n     from client_manager.edges where client_id = …',\n  ${start.id}, ${end.id}, directed => false);`,
        ms: Date.now() - started,
      },
    ],
  };
}

export async function browseCategory(
  client: BookClient,
  category: string,
): Promise<Outcome> {
  const started = Date.now();
  const id = category.trim().toLowerCase();
  const nodes = await nodesInCategory(client.id, id);
  const { branch, leaf } = categoryLabel(id);
  return {
    text:
      nodes.length === 0
        ? `Nothing under ${branch}${leaf ? ` › ${leaf}` : ""}.`
        : nodes.map((node) => line(client.id, node)).join("\n"),
    traces: [
      {
        clientId: client.id,
        step: {
          kind: "category",
          category: id,
          keys: nodes.map((node) => node.key),
        },
        sql: id.includes(".")
          ? `select * from client_manager.nodes where client_id = … and category = ${quoteSql(id)};`
          : `select * from client_manager.nodes where client_id = … and split_part(category, '.', 1) = ${quoteSql(id)};`,
        ms: Date.now() - started,
      },
    ],
  };
}

export async function readFacts(
  client: BookClient,
  keys: string[],
): Promise<Outcome> {
  const started = Date.now();
  const nodes = await nodesByKeys(client.id, keys);
  const evidence = await evidenceForNodes(
    client.id,
    nodes.map((node) => node.id),
  );
  return {
    text:
      nodes.length === 0
        ? "None of those Keys exist."
        : nodes
            .map((node) => {
              const quotes = evidence
                .filter((item) => item.node_id === node.id && item.quote)
                .slice(0, 4)
                .map(
                  (item) =>
                    `  "${item.quote}" (${item.source_name}, source ${item.source_id})`,
                );
              return [
                line(client.id, node),
                ...(quotes.length > 0
                  ? quotes
                  : ["  (no quote: inferred, or read from an image)"]),
              ].join("\n");
            })
            .join("\n"),
    data: {
      facts: nodes.map((node) => ({
        ref: refOf(client.id, node.key),
        label: node.label,
        category: node.category,
        confidence: node.confidence,
        certainty: certaintyOf(node.confidence),
        sources: evidence
          .filter((item) => item.node_id === node.id)
          .map((item) => ({
            id: item.source_id,
            name: item.source_name,
            quote: item.quote,
          })),
      })),
    },
    traces: [
      {
        clientId: client.id,
        step: { kind: "read", keys: nodes.map((node) => node.key) },
        sql: `select n.*, v.quote, s.name from client_manager.nodes n\n  join client_manager.evidence v on v.node_id = n.id\n  join client_manager.sources s on s.id = v.source_id\n where n.key = any(array[${nodes.map((node) => quoteSql(node.key)).join(", ")}]);`,
        ms: Date.now() - started,
      },
    ],
  };
}

// Documents -----------------------------------------------------------------------

export async function listSources(client: BookClient): Promise<Outcome> {
  const [sources, counts] = await Promise.all([
    sourcesOfClient(client.id),
    factsPerSource(client.id),
  ]);
  const backed = new Map(counts.map((row) => [row.source_id, row.total]));
  return {
    text:
      sources.length === 0
        ? "No documents yet."
        : sources
            .map(
              (source) =>
                `${source.name} | id ${source.id} | ${source.kind} | ${source.chars.toLocaleString("en-US")} characters | backs ${backed.get(source.id) ?? 0} facts`,
            )
            .join("\n"),
    data: {
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        facts: backed.get(source.id) ?? 0,
      })),
    },
  };
}

export async function readSource(
  client: BookClient,
  sourceId: string,
): Promise<Outcome> {
  const detail = await sourceDetail(client.id, sourceId);
  if (!detail) throw new ToolError("No such document for this client.");
  const { source, facts } = detail;
  const text = source.text ?? "";
  return {
    text: [
      `${source.name} (${source.kind}${source.kind === "image" ? ", read as pixels: no text" : ""})`,
      text.length > 12_000 ? `${text.slice(0, 12_000)}\n… (cut)` : text,
      `Facts that stand on it (${facts.length}):`,
      ...facts
        .slice(0, 60)
        .map(
          (fact) =>
            `- ${fact.node_label ?? `${fact.from_label} ${fact.edge_label} ${fact.to_label}`}: "${fact.quote}"`,
        ),
    ].join("\n"),
  };
}

// Research ------------------------------------------------------------------------

/** What is known and what is missing, so a web search knows where to look. */
export async function researchBrief(client: BookClient): Promise<Outcome> {
  const counts = await categoryCounts(client.id);
  const filled = new Map(counts.map((row) => [row.category, row.total]));
  const gaps = BRANCHES.flatMap((branch) =>
    branch.leaves
      .filter((leaf) => !filled.get(`${branch.id}.${leaf.id}`))
      .map((leaf) => `${branch.label} › ${leaf.label}: ${leaf.hint}`),
  );
  const profile = await clientProfile(client);
  return {
    text: [
      profile.text,
      "",
      "Gaps (no facts yet):",
      ...gaps.map((gap) => `- ${gap}`),
      "",
      "Look for public, professional facts only: career, companies and board seats, public filings, press, philanthropy, published interviews. Skip private matters (health, family conflicts, home addresses) unless already public in reputable press. Every fact needs the URL it came from.",
    ].join("\n"),
    data: { gaps },
  };
}
