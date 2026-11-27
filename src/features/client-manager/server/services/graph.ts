import type { Owner } from "@/features/access/domain/owner";
import { NotFoundError } from "@/platform/errors";
import { BRANCHES, categoryLabel } from "../../domain/categories";
import { handleOf, refOf } from "../../domain/citations";
import { certaintyOf } from "../../domain/confidence";
import type { TraversalStep } from "../../domain/events";
import { ROOT_KEY } from "../../domain/graph";
import { LIMITS } from "../../domain/limits";
import { type Book, type BookClient, bookOf, findClient } from "../book";
import type {
  BuildStore,
  Caller,
  ClientStore,
  Embedder,
  GraphStore,
} from "../ports";
import type { GraphNodeRow } from "../repository";
import type { BuildService } from "./builds";

export type GraphPorts = {
  graph: GraphStore;
  catalog: ClientStore["catalog"];
  builds: Pick<BuildStore, "latest">;
  embedder: Embedder;
  addFacts: BuildService["addFacts"];
};

export type Trace = {
  clientId: string;
  step: TraversalStep;
  sql: string;
  ms: number;
};

/** A tool's answer: lines a model reads, data a client may use, the Traversal the app draws. */
export type Outcome = {
  text: string;
  data?: Record<string, unknown>;
  traces?: Trace[];
};

type Fact = { text: string; sourceUrl?: string; sourceTitle?: string };

/**
 * What the Client Manager MCP server can do with the graphs. Every tool
 * reads only the Book its token reaches (the Owner's clients and the
 * Samples, or the one client a Desk token is narrowed to); clients are
 * addressed by id, Handle or name, Nodes by Key, and facts are cited as
 * `[[handle/key]]`. A search embeds its words (paid) only under the day's
 * spend cap, else it searches by words alone.
 */
export interface GraphTools {
  /** The Book a token reaches. */
  book(owner: Owner, visitorHash: string, only?: string | null): Promise<Book>;
  listClients(book: Book, query?: string): Outcome;
  clientProfile(book: Book, client: string): Promise<Outcome>;
  search(book: Book, query: string, client?: string | null): Promise<Outcome>;
  expand(
    book: Book,
    client: string,
    keys: string[],
    hops: number,
  ): Promise<Outcome>;
  connect(
    book: Book,
    client: string,
    from: string,
    to: string,
  ): Promise<Outcome>;
  browseCategory(
    book: Book,
    client: string,
    category: string,
  ): Promise<Outcome>;
  readFacts(book: Book, client: string, keys: string[]): Promise<Outcome>;
  listSources(book: Book, client: string): Promise<Outcome>;
  readSource(book: Book, client: string, sourceId: string): Promise<Outcome>;
  researchBrief(book: Book, client: string): Promise<Outcome>;
  buildStatus(book: Book, client: string): Promise<Outcome>;
  /** Facts as an addition Build, only on the caller's own client (the Build service checks). */
  addFacts(
    caller: Caller,
    book: Book,
    client: string,
    facts: Fact[],
  ): Promise<Outcome>;
}

const quoteSql = (value: string) =>
  `'${value.replace(/'/g, "''").slice(0, 60)}'`;

const percent = (value: number) => `${Math.round(value * 100)}%`;

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

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

export function createGraphTools(ports: GraphPorts): GraphTools {
  const { graph } = ports;

  function categoryMap(counts: { category: string; total: number }[]) {
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

  /** The profile, from Category counts already read (the Research brief reads them once for both). */
  async function profileOf(
    client: BookClient,
    counts: { category: string; total: number }[],
    started: number,
    edgesRead: ReturnType<GraphStore["edgesInScope"]>,
  ): Promise<Outcome> {
    const direct = (await edgesRead).slice(0, 40);
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
        categoryMap(counts),
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

  /** The day's spend cap for the one cheap paid call a search makes (its embedding). */
  async function canEmbed(visitor: string) {
    if (visitor === "e2e") return true;
    const day = await graph.usageSince(
      visitor,
      new Date(Date.now() - 86_400_000),
    );
    return day.cost < LIMITS.spendPerVisitorPerDay;
  }

  return {
    async book(owner, visitorHash, only) {
      return bookOf(await ports.catalog(owner), visitorHash, only);
    },

    listClients(book, query) {
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
    },

    async clientProfile(book, ref) {
      const client = findClient(book, ref);
      const started = Date.now();
      const edges = graph.edgesInScope(client.id, { kind: "root" });
      const [counts] = await Promise.all([
        graph.categoryCounts(client.id),
        edges,
      ]);
      return profileOf(client, counts, started, edges);
    },

    async search(book, query, ref) {
      const started = Date.now();
      const clients = ref
        ? [findClient(book, ref)]
        : book.clients.filter((client) => client.nodes > 1).slice(0, 25);
      if (clients.length === 0)
        return { text: "There are no clients to search." };
      const context = {
        clientId: null,
        buildId: null,
        visitorHash: book.visitor,
      };
      const embedding = (await canEmbed(book.visitor))
        ? ((await ports.embedder.embed(context, [query]).catch(() => null))
            ?.embeddings[0] ?? null)
        : null;
      const many = clients.length > 1;
      // Every client in one statement, not a query per client.
      const hits = await graph.searchAcross(
        clients.map((client) => client.id),
        query,
        embedding,
        many ? 5 : 8,
      );
      const ms = Date.now() - started;
      const byId = new Map(clients.map((client) => [client.id, client]));
      const merged = hits
        .flatMap((hit) => {
          const client = byId.get(hit.client_id);
          return client ? [{ client, hit }] : [];
        })
        .sort((a, b) => b.hit.score - a.hit.score)
        .slice(0, many ? 12 : 8);
      return {
        text:
          merged.length === 0
            ? "Nothing matched. Try other words, or browse_category."
            : merged
                .map(
                  ({ client, hit }) =>
                    `${many ? `${client.name}: ` : ""}${line(client.id, hit)}`,
                )
                .join("\n"),
        traces: clients
          .map((client) => ({
            client,
            found: hits.filter((hit) => hit.client_id === client.id),
          }))
          .filter(({ found }) => found.length > 0)
          .map(({ client, found }) => ({
            clientId: client.id,
            step: {
              kind: "search" as const,
              query,
              hits: found.map((hit) => ({
                key: hit.key,
                score: Number(hit.score.toFixed(4)),
              })),
            },
            sql: `select * from client_manager.search_nodes(client, ${quoteSql(query)}, embed(${quoteSql(query)}), 8);\n-- pgvector cosine (<=>) fused with tsvector rank`,
            ms,
          })),
      };
    },

    async expand(book, ref, keys, hops) {
      const client = findClient(book, ref);
      const started = Date.now();
      const seeds = await graph.nodesByKeys(client.id, keys);
      if (seeds.length === 0)
        throw new NotFoundError("None of those Keys exist. Use search first.");
      const reached = await graph.expandNodes(
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
      const nodes = [...byId.values()].sort((a, b) => a.depth - b.depth);
      // Both read the Nodes reached; neither needs the other.
      const [viaEdges, edges] = await Promise.all([
        graph.edgesByIds(
          client.id,
          nodes.flatMap((node) => (node.edge_id ? [node.edge_id] : [])),
        ),
        graph.edgesAmong(
          client.id,
          nodes.map((node) => node.id),
        ),
      ]);
      const viaKey = new Map(
        viaEdges.map((edge) => [edge.id, edgeKeyOf(edge)]),
      );
      return {
        text: [
          "Facts reached (ref | label | category | depth | confidence | summary | attributes):",
          ...nodes.map((node) =>
            line(client.id, node, ` | depth ${node.depth}`),
          ),
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
    },

    async connect(book, ref, from, to) {
      const client = findClient(book, ref);
      const started = Date.now();
      const ends = await graph.nodesByKeys(client.id, [from, to]);
      const start = ends.find((node) => node.key === from);
      const end = ends.find((node) => node.key === to);
      if (!start || !end)
        throw new NotFoundError(
          "One of those Keys does not exist. Use search first.",
        );
      const path = await graph.connectNodes(client.id, start.id, end.id);
      const edges = await graph.edgesByIds(
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
    },

    async browseCategory(book, ref, category) {
      const client = findClient(book, ref);
      const started = Date.now();
      const id = category.trim().toLowerCase();
      const nodes = await graph.nodesInCategory(client.id, id);
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
    },

    async readFacts(book, ref, keys) {
      const client = findClient(book, ref);
      const started = Date.now();
      // The Nodes and their quotes by Key, at once.
      const [nodes, evidence] = await Promise.all([
        graph.nodesByKeys(client.id, keys),
        graph.evidenceForKeys(client.id, keys),
      ]);
      return {
        text:
          nodes.length === 0
            ? "None of those Keys exist."
            : nodes
                .map((node) => {
                  const quotes = evidence
                    .filter((item) => item.key === node.key && item.quote)
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
              .filter((item) => item.key === node.key)
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
    },

    async listSources(book, ref) {
      const client = findClient(book, ref);
      const [sources, counts] = await Promise.all([
        graph.sources(client.id),
        graph.factsPerSource(client.id),
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
    },

    async readSource(book, ref, sourceId) {
      const client = findClient(book, ref);
      const detail = await graph.sourceDetail(client.id, sourceId);
      if (!detail) throw new NotFoundError("No such document for this client.");
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
    },

    async researchBrief(book, ref) {
      const client = findClient(book, ref);
      const started = Date.now();
      // One Category count and one Edge read for the profile and the gaps both.
      const edges = graph.edgesInScope(client.id, { kind: "root" });
      const [counts] = await Promise.all([
        graph.categoryCounts(client.id),
        edges,
      ]);
      const filled = new Map(counts.map((row) => [row.category, row.total]));
      const gaps = BRANCHES.flatMap((branch) =>
        branch.leaves
          .filter((leaf) => !filled.get(`${branch.id}.${leaf.id}`))
          .map((leaf) => `${branch.label} › ${leaf.label}: ${leaf.hint}`),
      );
      const profile = await profileOf(client, counts, started, edges);
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
    },

    async buildStatus(book, ref) {
      const client = findClient(book, ref);
      const build = await ports.builds.latest(client.id);
      if (!build) return { text: "No builds yet." };
      return {
        text: `Latest build ${build.id}: ${build.status}${build.stats ? `, ${build.stats.nodes} facts, ${build.stats.edges} relations, ${build.stats.repairs} self-corrections` : ""}${build.error ? `. ${build.error}` : ""}.`,
        data: { buildId: build.id, status: build.status },
      };
    },

    async addFacts(caller, book, ref, facts) {
      const target = findClient(book, ref);
      const { buildId, clientId, clientName } = await ports.addFacts(
        caller,
        target.id,
        { facts },
        facts.some((fact) => fact.sourceUrl) ? "research" : "chat",
      );
      return {
        text: `Adding ${plural(facts.length, "fact")} to ${clientName}. Build ${buildId} is running: the facts are checked against their sources and land in a minute or two.`,
        data: { buildId, clientId },
      };
    },
  };
}
