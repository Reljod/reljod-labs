import "server-only";
import type { Owner } from "@/features/access/domain/owner";
import type {
  BuildStats,
  Persona,
  SourceKind,
  TraversalStep,
  Usage,
} from "../domain/events";
import {
  type AppliedRepair,
  type DraftEdge,
  type DraftGraph,
  type DraftNode,
  edgeKey,
  type NodeType,
  ROOT_KEY,
} from "../domain/graph";
import { sql } from "./db";
import type { CallContext } from "./llm";

// Clients ---------------------------------------------------------------------

export type ClientRow = {
  id: string;
  /** Whose client this is (an Access Owner); null for samples and legacy rows. */
  owner: string | null;
  is_sample: boolean;
  name: string;
  status: "building" | "ready" | "failed";
  persona: Persona | null;
  portrait_path: string | null;
  portrait_source: "generated" | "uploaded" | null;
  visitor_hash: string;
  created_at: Date;
  updated_at: Date;
};

export async function createClientRow(input: {
  name: string;
  owner: Owner | null;
  isSample: boolean;
  visitorHash: string;
}): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    insert into client_manager.clients (name, owner, is_sample, visitor_hash)
    values (${input.name}, ${input.owner}, ${input.isSample}, ${input.visitorHash})
    returning id`;
  if (!row) throw new Error("Client was not created");
  // The client is the Root of their own graph from the start.
  await sql()`
    insert into client_manager.nodes (client_id, key, label, type, category, is_root, confidence)
    values (${row.id}, ${ROOT_KEY}, ${input.name}, 'person', 'profile.personal', true, 1)`;
  return row.id;
}

export async function getClient(id: string): Promise<ClientRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await sql()<ClientRow[]>`
    select * from client_manager.clients where id = ${id}`;
  return row ?? null;
}

/** Samples are open to everyone; anyone else's clients only to their Owner. */
export function canView(client: ClientRow, owner: Owner | null) {
  return client.is_sample || (!!owner && client.owner === owner);
}

export type CatalogRow = ClientRow & {
  node_count: number;
  edge_count: number;
  branch_counts: Record<string, number>;
  last_build_status: string | null;
};

export async function listCatalog(owner: Owner | null): Promise<CatalogRow[]> {
  return sql()<CatalogRow[]>`
    select c.*,
      (select count(*)::int from client_manager.nodes n where n.client_id = c.id) as node_count,
      (select count(*)::int from client_manager.edges e where e.client_id = c.id) as edge_count,
      coalesce((
        select jsonb_object_agg(branch, total) from (
          select split_part(category, '.', 1) as branch, count(*)::int as total
          from client_manager.nodes n where n.client_id = c.id and not n.is_root
          group by 1
        ) b
      ), '{}'::jsonb) as branch_counts,
      (select b.status from client_manager.builds b where b.client_id = c.id
        order by b.created_at desc limit 1) as last_build_status
    from client_manager.clients c
    where c.is_sample or (${owner}::text is not null and c.owner = ${owner}::text)
    order by c.is_sample, c.created_at desc
    limit 60`;
}

export async function setClientStatus(id: string, status: ClientRow["status"]) {
  await sql()`
    update client_manager.clients set status = ${status}, updated_at = now() where id = ${id}`;
}

export async function setPersona(id: string, persona: Persona) {
  await sql()`
    update client_manager.clients
    set persona = ${sql().json(persona)}, updated_at = now() where id = ${id}`;
}

export async function setPortrait(
  id: string,
  path: string,
  source: "generated" | "uploaded",
) {
  await sql()`
    update client_manager.clients
    set portrait_path = ${path}, portrait_source = ${source}, updated_at = now()
    where id = ${id}`;
}

export async function deleteClient(id: string) {
  await sql()`delete from client_manager.clients where id = ${id}`;
}

// Builds and Sources ------------------------------------------------------------

export type BuildRow = {
  id: string;
  client_id: string;
  workflow_run_id: string | null;
  trigger: "intake" | "addition";
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  stats: BuildStats | null;
  error: string | null;
  visitor_hash: string;
  created_at: Date;
  finished_at: Date | null;
};

export async function createBuild(input: {
  clientId: string;
  trigger: BuildRow["trigger"];
  visitorHash: string;
}): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    insert into client_manager.builds (client_id, trigger, visitor_hash)
    values (${input.clientId}, ${input.trigger}, ${input.visitorHash})
    returning id`;
  if (!row) throw new Error("Build was not created");
  return row.id;
}

/**
 * Moves a Build from queued to running, once: of two concurrent starts, only
 * the one that gets the row back may start a workflow.
 */
export async function claimBuild(id: string): Promise<boolean> {
  const rows = await sql()<{ id: string }[]>`
    update client_manager.builds set status = 'running'
    where id = ${id} and status = 'queued'
    returning id`;
  return rows.length > 0;
}

export async function getBuild(id: string): Promise<BuildRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await sql()<BuildRow[]>`
    select * from client_manager.builds where id = ${id}`;
  return row ?? null;
}

export async function updateBuild(
  id: string,
  patch: {
    status?: BuildRow["status"];
    workflowRunId?: string;
    stats?: BuildStats;
    error?: string;
  },
) {
  await sql()`
    update client_manager.builds set
      status = coalesce(${patch.status ?? null}, status),
      workflow_run_id = coalesce(${patch.workflowRunId ?? null}, workflow_run_id),
      stats = coalesce(${patch.stats ? sql().json(patch.stats) : null}::jsonb, stats),
      error = coalesce(${patch.error ?? null}, error),
      finished_at = case when ${patch.status ?? null} in ('completed', 'failed', 'stopped') then now() else finished_at end
    where id = ${id}`;
}

export async function latestBuild(clientId: string): Promise<BuildRow | null> {
  const [row] = await sql()<BuildRow[]>`
    select * from client_manager.builds where client_id = ${clientId}
    order by created_at desc limit 1`;
  return row ?? null;
}

export type SourceRow = {
  id: string;
  client_id: string;
  build_id: string | null;
  kind: SourceKind;
  name: string;
  media_type: string;
  storage_path: string | null;
  byte_size: number;
  text: string | null;
};

export async function createSources(
  rows: {
    clientId: string;
    buildId: string;
    kind: SourceKind;
    name: string;
    mediaType: string;
    storagePath: string | null;
    byteSize: number;
    text: string | null;
  }[],
): Promise<SourceRow[]> {
  if (rows.length === 0) return [];
  const values = rows.map((row) => ({
    client_id: row.clientId,
    build_id: row.buildId,
    kind: row.kind,
    name: row.name,
    media_type: row.mediaType,
    storage_path: row.storagePath,
    byte_size: row.byteSize,
    text: row.text,
  }));
  return sql()<SourceRow[]>`
    insert into client_manager.sources ${sql()(values)}
    returning id, client_id, build_id, kind, name, media_type, storage_path, byte_size, text`;
}

export async function sourcesOfBuild(buildId: string): Promise<SourceRow[]> {
  return sql()<SourceRow[]>`
    select id, client_id, build_id, kind, name, media_type, storage_path, byte_size, text
    from client_manager.sources where build_id = ${buildId} order by created_at, name`;
}

export async function sourcesOfClient(clientId: string) {
  return sql()<
    (Omit<SourceRow, "text"> & { chars: number; created_at: Date })[]
  >`
    select id, client_id, build_id, kind, name, media_type, storage_path, byte_size,
      coalesce(char_length(text), 0)::int as chars, created_at
    from client_manager.sources where client_id = ${clientId} order by created_at, name`;
}

export async function setSourceText(id: string, text: string | null) {
  await sql()`update client_manager.sources set text = ${text} where id = ${id}`;
}

export async function setSourcePath(id: string, path: string) {
  await sql()`update client_manager.sources set storage_path = ${path} where id = ${id}`;
}

// The graph ---------------------------------------------------------------------

type NodeRow = {
  id: number;
  key: string;
  label: string;
  type: NodeType;
  category: DraftNode["category"];
  summary: string;
  attributes: Record<string, string>;
  confidence: number;
};

type EdgeRow = {
  id: number;
  from_key: string;
  to_key: string;
  relation: string;
  label: string;
  confidence: number;
};

type EvidenceRow = {
  node_id: number | null;
  edge_id: number | null;
  source_id: string;
  quote: string;
};

/** The committed graph, in the Draft shape a Build or the view works with. */
export async function loadGraph(clientId: string): Promise<DraftGraph> {
  const [nodes, edges, evidence] = await Promise.all([
    sql()<NodeRow[]>`
      select id, key, label, type, category, summary, attributes, confidence
      from client_manager.nodes where client_id = ${clientId} order by id`,
    sql()<EdgeRow[]>`
      select e.id, s.key as from_key, t.key as to_key, e.relation, e.label, e.confidence
      from client_manager.edges e
      join client_manager.nodes s on s.id = e.source_id
      join client_manager.nodes t on t.id = e.target_id
      where e.client_id = ${clientId} order by e.id`,
    sql()<EvidenceRow[]>`
      select node_id, edge_id, source_id, quote
      from client_manager.evidence where client_id = ${clientId} order by id`,
  ]);
  const nodeEvidence = new Map<number, DraftNode["evidence"]>();
  const edgeEvidence = new Map<number, DraftEdge["evidence"]>();
  for (const row of evidence) {
    const target =
      row.node_id !== null
        ? (nodeEvidence.get(row.node_id) ??
          nodeEvidence.set(row.node_id, []).get(row.node_id))
        : row.edge_id !== null
          ? (edgeEvidence.get(row.edge_id) ??
            edgeEvidence.set(row.edge_id, []).get(row.edge_id))
          : undefined;
    target?.push({ sourceId: row.source_id, quote: row.quote });
  }
  return {
    nodes: nodes.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      type: row.type,
      category: row.category,
      summary: row.summary,
      attributes: asRecord(row.attributes),
      confidence: row.confidence,
      evidence: nodeEvidence.get(row.id) ?? [],
    })),
    edges: edges.map((row) => ({
      id: row.id,
      from: row.from_key,
      to: row.to_key,
      relation: row.relation,
      label: row.label,
      confidence: row.confidence,
      evidence: edgeEvidence.get(row.id) ?? [],
    })),
  };
}

/**
 * Makes Postgres hold exactly the Draft graph, in one transaction. Nodes are
 * matched by Key; one whose words changed loses its embedding, so the Embed
 * job indexes it again. Evidence is rewritten from the Draft, which carries
 * every quote, old and new.
 */
export async function commitGraph(clientId: string, graph: DraftGraph) {
  await sql().begin(async (tx) => {
    const keys = graph.nodes.map((node) => node.key);
    await tx`
      delete from client_manager.nodes
      where client_id = ${clientId} and not is_root and key <> all(${keys})`;
    const nodeValues = graph.nodes.map((node) => ({
      client_id: clientId,
      key: node.key,
      label: node.label.slice(0, 200),
      type: node.type,
      category: node.category,
      summary: node.summary.slice(0, 1000),
      attributes: tx.json(node.attributes),
      confidence: node.confidence,
      is_root: node.key === ROOT_KEY,
    }));
    const ids = await tx<{ id: number; key: string }[]>`
      insert into client_manager.nodes ${tx(nodeValues, "client_id", "key", "label", "type", "category", "summary", "attributes", "confidence", "is_root")}
      on conflict (client_id, key) do update set
        label = case when client_manager.nodes.is_root then client_manager.nodes.label else excluded.label end,
        type = excluded.type,
        category = case when client_manager.nodes.is_root then client_manager.nodes.category else excluded.category end,
        summary = excluded.summary,
        attributes = excluded.attributes,
        confidence = excluded.confidence,
        embedding = case
          when client_manager.nodes.label is distinct from excluded.label
            or client_manager.nodes.summary is distinct from excluded.summary
            or client_manager.nodes.attributes is distinct from excluded.attributes
            or client_manager.nodes.category is distinct from excluded.category
          then null else client_manager.nodes.embedding end,
        updated_at = now()
      returning id, key`;
    const idOf = new Map(ids.map((row) => [row.key, row.id]));

    await tx`delete from client_manager.edges where client_id = ${clientId}`;
    const edgeValues = graph.edges.flatMap((edge) => {
      const source = idOf.get(edge.from);
      const target = idOf.get(edge.to);
      return source && target && source !== target
        ? [
            {
              client_id: clientId,
              source_id: source,
              target_id: target,
              relation: edge.relation,
              label: edge.label.slice(0, 120),
              confidence: edge.confidence,
              key: edgeKey(edge),
            },
          ]
        : [];
    });
    const edgeIds =
      edgeValues.length > 0
        ? await tx<
            {
              id: number;
              source_id: number;
              target_id: number;
              relation: string;
            }[]
          >`
            insert into client_manager.edges ${tx(edgeValues, "client_id", "source_id", "target_id", "relation", "label", "confidence")}
            on conflict do nothing
            returning id, source_id, target_id, relation`
        : [];
    const edgeIdOf = new Map(
      edgeIds.map((row) => [
        `${row.source_id}|${row.relation}|${row.target_id}`,
        row.id,
      ]),
    );

    await tx`delete from client_manager.evidence where client_id = ${clientId}`;
    const validSources = new Set(
      (
        await tx<{ id: string }[]>`
          select id from client_manager.sources where client_id = ${clientId}`
      ).map((row) => row.id),
    );
    const evidenceValues = [
      ...graph.nodes.flatMap((node) =>
        node.evidence
          .filter((item) => validSources.has(item.sourceId))
          .map((item) => ({
            client_id: clientId,
            node_id: idOf.get(node.key) ?? null,
            edge_id: null,
            source_id: item.sourceId,
            quote: item.quote.slice(0, 600),
          })),
      ),
      ...graph.edges.flatMap((edge) => {
        const id = edgeIdOf.get(
          `${idOf.get(edge.from)}|${edge.relation}|${idOf.get(edge.to)}`,
        );
        return id
          ? edge.evidence
              .filter((item) => validSources.has(item.sourceId))
              .map((item) => ({
                client_id: clientId,
                node_id: null,
                edge_id: id,
                source_id: item.sourceId,
                quote: item.quote.slice(0, 600),
              }))
          : [];
      }),
    ].filter((row) => row.node_id !== null || row.edge_id !== null);
    for (let index = 0; index < evidenceValues.length; index += 500) {
      await tx`
        insert into client_manager.evidence ${tx(evidenceValues.slice(index, index + 500), "client_id", "node_id", "edge_id", "source_id", "quote")}`;
    }
  });
}

export async function nodesWithoutEmbedding(clientId: string) {
  return sql()<
    {
      id: number;
      key: string;
      label: string;
      category: string;
      summary: string;
      attributes: Record<string, string>;
      type: string;
    }[]
  >`
    select id, key, label, category, summary, attributes, type
    from client_manager.nodes where client_id = ${clientId} and embedding is null
    order by id limit 400`;
}

export async function setEmbeddings(
  rows: { id: number; embedding: number[] }[],
) {
  if (rows.length === 0) return;
  const values = rows.map((row) => [row.id, `[${row.embedding.join(",")}]`]);
  await sql()`
    update client_manager.nodes n set embedding = v.embedding::extensions.vector
    from (values ${sql()(values)}) as v(id, embedding)
    where n.id = v.id::bigint`;
}

export async function recordRepairs(
  buildId: string,
  round: number,
  repairs: AppliedRepair[],
) {
  if (repairs.length === 0) return;
  await sql()`
    insert into client_manager.repairs ${sql()(
      repairs.map(({ by, op, touches: _touches, ...detail }) => ({
        build_id: buildId,
        round,
        by,
        op,
        detail: sql().json(detail as Record<string, string>),
      })),
    )}`;
}

// Traversal ---------------------------------------------------------------------

export type GraphNodeRow = {
  id: number;
  key: string;
  label: string;
  type: string;
  category: string;
  summary: string;
  attributes: Record<string, string>;
  confidence: number;
};

export async function searchNodes(
  clientId: string,
  query: string,
  embedding: number[] | null,
  limit = 8,
) {
  const vector = embedding ? `[${embedding.join(",")}]` : null;
  return sql()<
    (GraphNodeRow & {
      score: number;
      semantic: number | null;
      lexical: number | null;
    })[]
  >`
    select n.id, n.key, n.label, n.type, n.category, n.summary, n.attributes, n.confidence,
      s.score, s.semantic, s.lexical
    from client_manager.search_nodes(${clientId}, ${query}, ${vector}::extensions.vector, ${limit}) s
    join client_manager.nodes n on n.id = s.node_id
    order by s.score desc`;
}

export async function expandNodes(
  clientId: string,
  seedIds: number[],
  hops: number,
  limit = 40,
) {
  return sql()<(GraphNodeRow & { depth: number; edge_id: number | null })[]>`
    select n.id, n.key, n.label, n.type, n.category, n.summary, n.attributes, n.confidence,
      x.depth, x.edge_id
    from client_manager.expand_nodes(${clientId}, ${seedIds}::bigint[], ${hops}, ${limit}) x
    join client_manager.nodes n on n.id = x.node_id
    order by x.depth, n.id`;
}

export async function connectNodes(
  clientId: string,
  fromId: number,
  toId: number,
) {
  return sql()<
    { step: number; key: string; label: string; edge_id: number | null }[]
  >`
    select c.step, n.key, n.label, c.edge_id
    from client_manager.connect_nodes(${clientId}, ${fromId}, ${toId}) c
    join client_manager.nodes n on n.id = c.node_id
    order by c.step`;
}

export async function nodesByKeys(clientId: string, keys: string[]) {
  if (keys.length === 0) return [];
  return sql()<GraphNodeRow[]>`
    select id, key, label, type, category, summary, attributes, confidence
    from client_manager.nodes where client_id = ${clientId} and key = any(${keys})`;
}

export async function nodesInCategory(clientId: string, category: string) {
  const branch = !category.includes(".");
  return sql()<GraphNodeRow[]>`
    select id, key, label, type, category, summary, attributes, confidence
    from client_manager.nodes
    where client_id = ${clientId} and not is_root
      and (case when ${branch} then split_part(category, '.', 1) = ${category} else category = ${category} end)
    order by id limit 40`;
}

/** Edges among a set of Nodes, with their Keys and the SQL the trace shows. */
export async function edgesAmong(clientId: string, ids: number[]) {
  if (ids.length === 0) return [];
  return sql()<
    {
      id: number;
      from_key: string;
      to_key: string;
      relation: string;
      label: string;
      confidence: number;
    }[]
  >`
    select e.id, s.key as from_key, t.key as to_key, e.relation, e.label, e.confidence
    from client_manager.edges e
    join client_manager.nodes s on s.id = e.source_id
    join client_manager.nodes t on t.id = e.target_id
    where e.client_id = ${clientId} and e.source_id = any(${ids}::bigint[]) and e.target_id = any(${ids}::bigint[])`;
}

export async function edgesByIds(clientId: string, ids: number[]) {
  if (ids.length === 0) return [];
  return sql()<
    {
      id: number;
      from_key: string;
      to_key: string;
      relation: string;
      label: string;
      confidence: number;
    }[]
  >`
    select e.id, s.key as from_key, t.key as to_key, e.relation, e.label, e.confidence
    from client_manager.edges e
    join client_manager.nodes s on s.id = e.source_id
    join client_manager.nodes t on t.id = e.target_id
    where e.client_id = ${clientId} and e.id = any(${ids}::bigint[])`;
}

export async function evidenceForNodes(clientId: string, ids: number[]) {
  if (ids.length === 0) return [];
  return sql()<
    {
      node_id: number;
      quote: string;
      source_id: string;
      source_name: string;
      source_kind: string;
    }[]
  >`
    select v.node_id, v.quote, s.id as source_id, s.name as source_name, s.kind as source_kind
    from client_manager.evidence v
    join client_manager.sources s on s.id = v.source_id
    where v.client_id = ${clientId} and v.node_id = any(${ids}::bigint[])
    order by v.id`;
}

export async function categoryCounts(clientId: string) {
  return sql()<{ category: string; total: number }[]>`
    select category, count(*)::int as total
    from client_manager.nodes where client_id = ${clientId} and not is_root
    group by category order by category`;
}

// Conversation ------------------------------------------------------------------

export type MessageRow = {
  id: string;
  role: "user" | "assistant";
  mode: "ask" | "add" | "build";
  content: string;
  traversal: {
    steps: { step: TraversalStep; sql: string; ms: number }[];
    cited: string[];
    reasoning?: string;
  } | null;
  build_id: string | null;
  created_at: Date;
};

export async function addMessage(input: {
  clientId: string;
  /** Null for a sample client's Build messages. */
  owner: Owner | null;
  role: MessageRow["role"];
  mode: MessageRow["mode"];
  content: string;
  traversal?: MessageRow["traversal"];
  buildId?: string | null;
  visitorHash: string;
}): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    insert into client_manager.messages
      (client_id, owner, role, mode, content, traversal, build_id, visitor_hash)
    values (${input.clientId}, ${input.owner}, ${input.role}, ${input.mode},
      ${input.content}, ${input.traversal ? sql().json(input.traversal) : null},
      ${input.buildId ?? null}, ${input.visitorHash})
    returning id`;
  if (!row) throw new Error("Message was not saved");
  return row.id;
}

// Limits ------------------------------------------------------------------------

export async function recordModelCall(context: CallContext, usage: Usage) {
  await sql()`
    insert into client_manager.model_calls
      (client_id, build_id, purpose, model, input_tokens, output_tokens, cost_usd, latency_ms, visitor_hash)
    values (${context.clientId}, ${context.buildId}, ${usage.purpose}, ${usage.model},
      ${usage.inputTokens}, ${usage.outputTokens}, ${usage.costUsd}, ${usage.ms}, ${context.visitorHash})`;
}

export async function usageSince(visitorHash: string | null, since: Date) {
  const [row] = await sql()<
    { builds: number; messages: number; cost: number }[]
  >`
    select
      (select count(*)::int from client_manager.builds
        where created_at >= ${since} and (${visitorHash}::text is null or visitor_hash = ${visitorHash})) as builds,
      (select count(*)::int from client_manager.messages
        where role = 'user' and mode in ('ask', 'research') and created_at >= ${since}
          and (${visitorHash}::text is null or visitor_hash = ${visitorHash})) as messages,
      (select coalesce(sum(cost_usd), 0)::float8 from client_manager.model_calls
        where created_at >= ${since} and (${visitorHash}::text is null or visitor_hash = ${visitorHash})) as cost`;
  return row ?? { builds: 0, messages: 0, cost: 0 };
}

export type ClientStats = {
  cost: number;
  tokens: number;
  edges: number;
  build: Pick<BuildRow, "id" | "status" | "trigger" | "stats" | "error"> | null;
};

/**
 * What the Client file's header needs besides its Nodes and Sources: spend,
 * the Edge total and the latest Build, in one round trip instead of three.
 */
export async function clientStats(clientId: string): Promise<ClientStats> {
  const [row] = await sql()<ClientStats[]>`
    select
      (select coalesce(sum(cost_usd), 0)::float8 from client_manager.model_calls
        where client_id = ${clientId}) as cost,
      (select coalesce(sum(input_tokens + output_tokens), 0)::int from client_manager.model_calls
        where client_id = ${clientId}) as tokens,
      (select count(*)::int from client_manager.edges where client_id = ${clientId}) as edges,
      (select jsonb_build_object('id', b.id, 'status', b.status, 'trigger', b.trigger,
          'stats', b.stats, 'error', b.error)
        from client_manager.builds b where b.client_id = ${clientId}
        order by b.created_at desc limit 1) as build`;
  return row ?? { cost: 0, tokens: 0, edges: 0, build: null };
}

export async function buildSpend(buildId: string) {
  const [row] = await sql()<{ cost: number; tokens: number }[]>`
    select coalesce(sum(cost_usd), 0)::float8 as cost,
      coalesce(sum(input_tokens + output_tokens), 0)::int as tokens
    from client_manager.model_calls where build_id = ${buildId}`;
  return row ?? { cost: 0, tokens: 0 };
}

/** jsonb attributes, tolerating rows written as a JSON string. */
function asRecord(value: unknown): Record<string, string> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, string>)
    : {};
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

// Lazy views of one client ---------------------------------------------------------

export type NodeLiteRow = {
  id: number;
  key: string;
  label: string;
  type: NodeType;
  category: DraftNode["category"];
  summary: string;
  attributes: Record<string, string>;
  confidence: number;
  source_ids: string[];
  quotes: number;
};

/** Every Node without its quotes: enough for the profile and the map's first frame. */
export async function nodesLite(clientId: string) {
  const rows = await sql()<NodeLiteRow[]>`
    select n.id, n.key, n.label, n.type, n.category, n.summary, n.attributes, n.confidence,
      coalesce(array_agg(distinct v.source_id) filter (where v.source_id is not null), '{}') as source_ids,
      count(v.id)::int as quotes
    from client_manager.nodes n
    left join client_manager.evidence v on v.node_id = n.id
    where n.client_id = ${clientId}
    group by n.id
    order by n.id`;
  return rows.map((row) => ({ ...row, attributes: asRecord(row.attributes) }));
}

export type EdgeLiteRow = {
  id: number;
  from_key: string;
  to_key: string;
  relation: string;
  label: string;
  confidence: number;
  quotes: number;
};

export type EdgeScope =
  | { kind: "root" }
  | { kind: "branch"; id: string }
  | { kind: "leaf"; id: string }
  | { kind: "node"; key: string };

/**
 * The Edges one part of the map needs: those touching the client, a Branch,
 * a leaf Category or one Node. The map asks for more as you open things.
 */
export async function edgesInScope(clientId: string, scope: EdgeScope) {
  const branch = scope.kind === "branch" ? scope.id : null;
  const leaf = scope.kind === "leaf" ? scope.id : null;
  const key = scope.kind === "node" ? scope.key : null;
  const root = scope.kind === "root";
  return sql()<EdgeLiteRow[]>`
    select e.id, s.key as from_key, t.key as to_key, e.relation, e.label, e.confidence,
      (select count(*)::int from client_manager.evidence v where v.edge_id = e.id) as quotes
    from client_manager.edges e
    join client_manager.nodes s on s.id = e.source_id
    join client_manager.nodes t on t.id = e.target_id
    where e.client_id = ${clientId}
      and (
        (${root} and (s.is_root or t.is_root))
        or (${branch}::text is not null and (split_part(s.category, '.', 1) = ${branch} or split_part(t.category, '.', 1) = ${branch}))
        or (${leaf}::text is not null and (s.category = ${leaf} or t.category = ${leaf}))
        or (${key}::text is not null and (s.key = ${key} or t.key = ${key}))
      )
    order by e.confidence desc, e.id
    limit 400`;
}

/** One Node in full: what it says, the quotes it stands on, and every link with its own quotes. */
export async function nodeDetail(clientId: string, key: string) {
  const [node] = await sql()<(GraphNodeRow & { is_root: boolean })[]>`
    select id, key, label, type, category, summary, attributes, confidence, is_root
    from client_manager.nodes where client_id = ${clientId} and key = ${key}`;
  if (!node) return null;
  const [evidence, edges] = await Promise.all([
    sql()<{ source_id: string; quote: string }[]>`
      select source_id, quote from client_manager.evidence
      where node_id = ${node.id} order by id limit 40`,
    sql()<
      (EdgeLiteRow & {
        evidence: { source_id: string; quote: string }[] | null;
      })[]
    >`
      select e.id, s.key as from_key, t.key as to_key, e.relation, e.label, e.confidence,
        0 as quotes,
        (select jsonb_agg(jsonb_build_object('source_id', v.source_id, 'quote', v.quote))
           from client_manager.evidence v where v.edge_id = e.id) as evidence
      from client_manager.edges e
      join client_manager.nodes s on s.id = e.source_id
      join client_manager.nodes t on t.id = e.target_id
      where e.client_id = ${clientId} and (e.source_id = ${node.id} or e.target_id = ${node.id})
      order by e.confidence desc
      limit 120`,
  ]);
  return {
    node: { ...node, attributes: asRecord(node.attributes) },
    evidence,
    edges,
  };
}

/** A Source's full text and every fact that stands on it. */
export async function sourceDetail(clientId: string, sourceId: string) {
  if (!isUuid(sourceId)) return null;
  const [source] = await sql()<
    (SourceRow & { created_at: Date; build_id: string | null })[]
  >`
    select id, client_id, build_id, kind, name, media_type, storage_path, byte_size, text, created_at
    from client_manager.sources where client_id = ${clientId} and id = ${sourceId}`;
  if (!source) return null;
  const facts = await sql()<
    {
      quote: string;
      node_key: string | null;
      node_label: string | null;
      category: string | null;
      confidence: number;
      edge_label: string | null;
      from_label: string | null;
      to_label: string | null;
    }[]
  >`
    select v.quote, n.key as node_key, n.label as node_label, n.category,
      coalesce(n.confidence, e.confidence, 0.5) as confidence,
      e.label as edge_label, s.label as from_label, t.label as to_label
    from client_manager.evidence v
    left join client_manager.nodes n on n.id = v.node_id
    left join client_manager.edges e on e.id = v.edge_id
    left join client_manager.nodes s on s.id = e.source_id
    left join client_manager.nodes t on t.id = e.target_id
    where v.source_id = ${sourceId}
    order by v.id
    limit 300`;
  return { source, facts };
}

/** How many facts each Source of a client backs. */
export async function factsPerSource(clientId: string) {
  return sql()<{ source_id: string; total: number }[]>`
    select source_id, count(*)::int as total
    from client_manager.evidence where client_id = ${clientId}
    group by source_id`;
}

// Threads -------------------------------------------------------------------------

export type ThreadRow = {
  id: string;
  owner: string | null;
  client_id: string | null;
  title: string;
  created_at: Date;
  updated_at: Date;
};

export async function createThread(input: {
  owner: Owner;
  clientId: string | null;
  title?: string;
  visitorHash: string;
}): Promise<ThreadRow> {
  const [row] = await sql()<ThreadRow[]>`
    insert into client_manager.threads (owner, client_id, title, visitor_hash)
    values (${input.owner}, ${input.clientId}, ${input.title ?? "New chat"}, ${input.visitorHash})
    returning id, owner, client_id, title, created_at, updated_at`;
  if (!row) throw new Error("Thread was not created");
  return row;
}

export async function getThread(id: string): Promise<ThreadRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await sql()<ThreadRow[]>`
    select id, owner, client_id, title, created_at, updated_at
    from client_manager.threads where id = ${id}`;
  return row ?? null;
}

export async function listThreads(owner: Owner) {
  return sql()<
    (ThreadRow & { client_name: string | null; preview: string | null })[]
  >`
    select t.id, t.owner, t.client_id, t.title, t.created_at, t.updated_at,
      c.name as client_name,
      (select m.content from client_manager.messages m
        where m.thread_id = t.id and m.role = 'assistant'
        order by m.created_at desc limit 1) as preview
    from client_manager.threads t
    left join client_manager.clients c on c.id = t.client_id
    where t.owner = ${owner}
    order by t.updated_at desc
    limit 100`;
}

export async function updateThread(
  id: string,
  patch: { title?: string; clientId?: string | null },
) {
  const setClient = patch.clientId !== undefined;
  await sql()`
    update client_manager.threads set
      title = coalesce(${patch.title ?? null}, title),
      client_id = case when ${setClient} then ${patch.clientId ?? null}::uuid else client_id end,
      updated_at = now()
    where id = ${id}`;
}

export async function deleteThread(id: string) {
  await sql()`delete from client_manager.threads where id = ${id}`;
}

export type ThreadMessageRow = {
  id: string;
  role: "user" | "assistant";
  mode: MessageRow["mode"] | "research";
  content: string;
  client_id: string | null;
  traversal: {
    trail?: unknown[];
    cited?: unknown[];
    reasoning?: string;
  } | null;
  proposal: unknown;
  build_id: string | null;
  created_at: Date;
};

export async function addThreadMessage(input: {
  threadId: string;
  owner: Owner;
  clientId: string | null;
  role: "user" | "assistant";
  mode: "ask" | "research";
  content: string;
  traversal?: ThreadMessageRow["traversal"];
  proposal?: unknown;
  buildId?: string | null;
  visitorHash: string;
}): Promise<string> {
  const [row] = await sql()<{ id: string }[]>`
    insert into client_manager.messages
      (thread_id, client_id, owner, role, mode, content, traversal, proposal, build_id, visitor_hash)
    values (${input.threadId}, ${input.clientId}, ${input.owner}, ${input.role}, ${input.mode},
      ${input.content}, ${input.traversal ? sql().json(input.traversal as never) : null},
      ${input.proposal ? sql().json(input.proposal as never) : null},
      ${input.buildId ?? null}, ${input.visitorHash})
    returning id`;
  if (!row) throw new Error("Message was not saved");
  await sql()`update client_manager.threads set updated_at = now() where id = ${input.threadId}`;
  return row.id;
}

export async function threadMessages(threadId: string) {
  return sql()<ThreadMessageRow[]>`
    select id, role, mode, content, client_id, traversal, proposal, build_id, created_at
    from client_manager.messages
    where thread_id = ${threadId}
    order by created_at, role desc
    limit 300`;
}

export async function threadHistory(threadId: string, limit = 10) {
  const rows = await sql()<{ role: "user" | "assistant"; content: string }[]>`
    select role, content from client_manager.messages
    where thread_id = ${threadId}
    order by created_at desc limit ${limit}`;
  return rows.reverse();
}

export async function getThreadMessage(threadId: string, messageId: string) {
  if (!isUuid(messageId)) return null;
  const [row] = await sql()<ThreadMessageRow[]>`
    select id, role, mode, content, client_id, traversal, proposal, build_id, created_at
    from client_manager.messages where thread_id = ${threadId} and id = ${messageId}`;
  return row ?? null;
}

/** Moves a proposal from open to decided, once: of two clicks, one wins. */
export async function decideProposal(
  messageId: string,
  proposal: unknown,
): Promise<boolean> {
  const rows = await sql()<{ id: string }[]>`
    update client_manager.messages set proposal = ${sql().json(proposal as never)}
    where id = ${messageId} and proposal->>'status' = 'open'
    returning id`;
  return rows.length > 0;
}

export async function researchSince(visitorHash: string, since: Date) {
  const [row] = await sql()<{ total: number }[]>`
    select count(*)::int as total from client_manager.messages
    where role = 'user' and mode = 'research' and visitor_hash = ${visitorHash}
      and created_at >= ${since}`;
  return row?.total ?? 0;
}

export async function setProposal(messageId: string, proposal: unknown) {
  await sql()`
    update client_manager.messages set proposal = ${sql().json(proposal as never)}
    where id = ${messageId}`;
}
