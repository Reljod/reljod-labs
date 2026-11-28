import "server-only";
import type postgres from "postgres";
import type { Owner } from "@/features/access/domain/owner";
import { type EdgeScope, isUuid } from "../domain/api";
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
import type { Usage24h } from "../domain/limits";
import { sql } from "./db";
import type { CallContext } from "./llm";

/** A connection or a transaction: the repository's writes take either. */
export type Db = ReturnType<typeof sql> | postgres.TransactionSql;

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

export async function createClientRow(
  input: {
    name: string;
    owner: Owner | null;
    isSample: boolean;
    visitorHash: string;
  },
  db: Db = sql(),
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into client_manager.clients (name, owner, is_sample, visitor_hash)
    values (${input.name}, ${input.owner}, ${input.isSample}, ${input.visitorHash})
    returning id`;
  if (!row) throw new Error("Client was not created");
  // The client is the Root of their own graph from the start.
  await db`
    insert into client_manager.nodes (client_id, key, label, type, category, is_root, confidence)
    values (${row.id}, ${ROOT_KEY}, ${input.name}, 'person', 'profile.personal', true, 1)`;
  return row.id;
}

export async function getClient(id: string): Promise<ClientRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await sql()<ClientRow[]>`
    select * from client_manager.clients where id = ${id} and deleted_at is null`;
  return row ?? null;
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
    where c.deleted_at is null
      and (c.is_sample or (${owner}::text is not null and c.owner = ${owner}::text))
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

/**
 * Marks a client deleted: every read stops seeing it at once, and its rows
 * and Storage files go later, in `purgeDeletedClients` (or with the client's
 * own expiry). A person's delete never removes data on the spot.
 */
export async function deleteClient(id: string) {
  await sql()`
    update client_manager.clients set deleted_at = now()
    where id = ${id} and deleted_at is null`;
}

/** Clients deleted long enough ago (or about to expire anyway) to purge. */
export async function clientsToPurge(limit: number) {
  return sql()<{ id: string }[]>`
    select id from client_manager.clients
    where deleted_at is not null
      and (deleted_at < now() - interval '30 days' or expires_at < now() + interval '1 day')
    order by deleted_at
    limit ${limit}`;
}

/** Removes a deleted client's rows for good; everything under it cascades. */
export async function purgeClient(id: string) {
  await sql()`
    delete from client_manager.clients where id = ${id} and deleted_at is not null`;
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

export async function createBuild(
  input: {
    clientId: string;
    trigger: BuildRow["trigger"];
    visitorHash: string;
  },
  db: Db = sql(),
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
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

/** A Build with who its client belongs to, in one statement; none once the client is deleted. */
export async function buildWithClient(
  id: string,
): Promise<
  (BuildRow & { client_owner: string | null; client_is_sample: boolean }) | null
> {
  if (!isUuid(id)) return null;
  const [row] = await sql()<
    (BuildRow & { client_owner: string | null; client_is_sample: boolean })[]
  >`
    select b.*, c.owner as client_owner, c.is_sample as client_is_sample
    from client_manager.builds b
    join client_manager.clients c on c.id = b.client_id and c.deleted_at is null
    where b.id = ${id}`;
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

/** The text read from several Sources, in one statement. */
export async function setSourceTexts(rows: { id: string; text: string }[]) {
  if (rows.length === 0) return;
  const values = rows.map((row) => [row.id, row.text]);
  await sql()`
    update client_manager.sources s set text = v.text
    from (values ${sql()(values)}) as v(id, text)
    where s.id = v.id::uuid`;
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

/**
 * A search of several clients at once, in one statement: `search_nodes` per
 * client in a lateral join, not one query per client of the book.
 */
export async function searchNodesAcross(
  clientIds: string[],
  query: string,
  embedding: number[] | null,
  limit: number,
) {
  if (clientIds.length === 0) return [];
  // No vector (none made, or an empty one): words alone.
  const vector = embedding?.length ? `[${embedding.join(",")}]` : null;
  return sql()<
    (GraphNodeRow & {
      client_id: string;
      score: number;
      semantic: number | null;
      lexical: number | null;
    })[]
  >`
    select c.client_id, n.id, n.key, n.label, n.type, n.category, n.summary, n.attributes,
      n.confidence, s.score, s.semantic, s.lexical
    from unnest(${clientIds}::uuid[]) as c(client_id)
    cross join lateral client_manager.search_nodes(
      c.client_id, ${query}, ${vector}::extensions.vector, ${limit}) s
    join client_manager.nodes n on n.id = s.node_id
    order by s.score desc`;
}

/** The labels of cited Nodes, for any number of clients, in one statement. */
export async function nodesByClientKeys(
  refs: { clientId: string; key: string }[],
) {
  if (refs.length === 0) return [];
  return sql()<{ client_id: string; key: string; label: string }[]>`
    select n.client_id, n.key, n.label
    from client_manager.nodes n
    join unnest(${refs.map((ref) => ref.clientId)}::uuid[], ${refs.map((ref) => ref.key)}::text[])
      as r(client_id, key) on r.client_id = n.client_id and r.key = n.key`;
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

/** The quotes of Nodes by Key, so they are read beside the Nodes, not after them. */
export async function evidenceForKeys(clientId: string, keys: string[]) {
  if (keys.length === 0) return [];
  return sql()<
    {
      key: string;
      quote: string;
      source_id: string;
      source_name: string;
      source_kind: string;
    }[]
  >`
    select n.key, v.quote, s.id as source_id, s.name as source_name, s.kind as source_kind
    from client_manager.nodes n
    join client_manager.evidence v on v.node_id = n.id
    join client_manager.sources s on s.id = v.source_id
    where n.client_id = ${clientId} and n.key = any(${keys})
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
      (client_id, build_id, owner, purpose, model, input_tokens, output_tokens, cost_usd, latency_ms, visitor_hash)
    values (${context.clientId}, ${context.buildId}, ${context.owner ?? null}, ${usage.purpose}, ${usage.model},
      ${usage.inputTokens}, ${usage.outputTokens}, ${usage.costUsd}, ${usage.ms}, ${context.visitorHash})`;
}

/**
 * Everything the caps read, in one round trip. Run inside the transaction
 * that holds the caps' advisory locks (`takeLimit` in `service.ts`), so the
 * count and the insert that follows cannot interleave with another request.
 * An Owner's spend is the calls tagged with them plus every call on one of
 * their clients (Builds run in a workflow that knows the client, not the
 * Owner).
 */
export async function usageFor(
  db: Db,
  who: { visitorHash: string; owner: string | null },
): Promise<Usage24h> {
  const [row] = await db<Usage24h[]>`
    select
      (select count(*)::int from client_manager.builds
        where visitor_hash = ${who.visitorHash} and created_at >= now() - interval '1 hour') as "hourBuilds",
      (select count(*)::int from client_manager.messages
        where role = 'user' and mode in ('ask', 'research') and visitor_hash = ${who.visitorHash}
          and created_at >= now() - interval '1 hour') as "hourAsks",
      (select count(*)::int from client_manager.messages
        where role = 'user' and mode = 'research' and visitor_hash = ${who.visitorHash}
          and created_at >= now() - interval '1 hour') as "hourResearch",
      (select coalesce(sum(cost_usd), 0)::float8 from client_manager.model_calls
        where visitor_hash = ${who.visitorHash} and created_at >= now() - interval '1 day') as "visitorCost",
      (select coalesce(sum(m.cost_usd), 0)::float8 from client_manager.model_calls m
        where m.created_at >= now() - interval '1 day'
          and (m.owner = ${who.owner}::text or m.client_id in (
            select c.id from client_manager.clients c where c.owner = ${who.owner}::text))) as "ownerCost",
      (select count(*)::int from client_manager.builds
        where created_at >= now() - interval '1 day') as "allBuilds",
      (select count(*)::int from client_manager.messages
        where role = 'user' and mode in ('ask', 'research')
          and created_at >= now() - interval '1 day') as "allAsks"`;
  return (
    row ?? {
      hourBuilds: 0,
      hourAsks: 0,
      hourResearch: 0,
      visitorCost: 0,
      ownerCost: 0,
      allBuilds: 0,
      allAsks: 0,
    }
  );
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

/** The latest Build as the Client file's header shows it. */
type LatestBuild = Pick<
  BuildRow,
  "id" | "status" | "trigger" | "stats" | "error"
> | null;

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

/** A Source as the Client file lists it: no text, how long it is and how many facts it backs. */
export type SourceLiteRow = {
  id: string;
  build_id: string | null;
  kind: SourceKind;
  name: string;
  media_type: string;
  chars: number;
  facts: number;
  /** ISO 8601, as jsonb prints a timestamptz. */
  created_at: string;
};

/** A Client file's first frame, read in one statement (see `clientFile`). */
export type ClientFileRow = ClientRow & {
  nodes: Omit<NodeLiteRow, "id">[];
  sources: SourceLiteRow[];
  cost: number;
  tokens: number;
  edges: number;
  build: LatestBuild;
};

/**
 * The Client file's first frame in ONE statement: the client's row, every
 * Node without its quotes, the Sources with the facts each backs, spend, the
 * Edge total and the latest Build. It used to be the lookup, then four
 * queries on a pool of four: two database rounds. Not scoped here: the
 * service hands it only to an Owner who may see the client.
 */
export async function clientFile(id: string): Promise<ClientFileRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await sql()<ClientFileRow[]>`
    select c.*,
      coalesce((
        select jsonb_agg(jsonb_build_object(
            'key', n.key, 'label', n.label, 'type', n.type, 'category', n.category,
            'summary', n.summary, 'attributes', n.attributes, 'confidence', n.confidence,
            'source_ids', coalesce(v.source_ids, '{}'), 'quotes', coalesce(v.quotes, 0))
          order by n.id)
        from client_manager.nodes n
        left join lateral (
          select array_agg(distinct e.source_id) as source_ids, count(*)::int as quotes
          from client_manager.evidence e where e.node_id = n.id
        ) v on true
        where n.client_id = c.id
      ), '[]'::jsonb) as nodes,
      coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', s.id, 'build_id', s.build_id, 'kind', s.kind, 'name', s.name,
            'media_type', s.media_type, 'chars', coalesce(char_length(s.text), 0),
            'facts', coalesce(f.total, 0), 'created_at', s.created_at)
          order by s.created_at, s.name)
        from client_manager.sources s
        left join (
          select source_id, count(*)::int as total from client_manager.evidence
          where client_id = c.id group by source_id
        ) f on f.source_id = s.id
        where s.client_id = c.id
      ), '[]'::jsonb) as sources,
      (select coalesce(sum(cost_usd), 0)::float8 from client_manager.model_calls
        where client_id = c.id) as cost,
      (select coalesce(sum(input_tokens + output_tokens), 0)::int from client_manager.model_calls
        where client_id = c.id) as tokens,
      (select count(*)::int from client_manager.edges where client_id = c.id) as edges,
      (select jsonb_build_object('id', b.id, 'status', b.status, 'trigger', b.trigger,
          'stats', b.stats, 'error', b.error)
        from client_manager.builds b where b.client_id = c.id
        order by b.created_at desc limit 1) as build
    from client_manager.clients c
    where c.id = ${id} and c.deleted_at is null`;
  if (!row) return null;
  return {
    ...row,
    nodes: row.nodes.map((node) => ({
      ...node,
      attributes: asRecord(node.attributes),
    })),
  };
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
  // The Node, its quotes and its links by Key, all at once: one round, not
  // the Node's id first and then the rest.
  const [[node], evidence, edges] = await Promise.all([
    sql()<(GraphNodeRow & { is_root: boolean })[]>`
      select id, key, label, type, category, summary, attributes, confidence, is_root
      from client_manager.nodes where client_id = ${clientId} and key = ${key}`,
    sql()<{ source_id: string; quote: string }[]>`
      select v.source_id, v.quote from client_manager.evidence v
      join client_manager.nodes n on n.id = v.node_id
      where n.client_id = ${clientId} and n.key = ${key}
      order by v.id limit 40`,
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
      where e.client_id = ${clientId} and (s.key = ${key} or t.key = ${key})
      order by e.confidence desc
      limit 120`,
  ]);
  if (!node) return null;
  return {
    node: { ...node, attributes: asRecord(node.attributes) },
    evidence,
    edges,
  };
}

/** A Source's full text and every fact that stands on it, in one round. */
export async function sourceDetail(clientId: string, sourceId: string) {
  if (!isUuid(sourceId)) return null;
  const [[source], facts] = await Promise.all([
    sql()<(SourceRow & { created_at: Date; build_id: string | null })[]>`
      select id, client_id, build_id, kind, name, media_type, storage_path, byte_size, text, created_at
      from client_manager.sources where client_id = ${clientId} and id = ${sourceId}`,
    sourceFacts(clientId, sourceId),
  ]);
  return source ? { source, facts } : null;
}

function sourceFacts(clientId: string, sourceId: string) {
  return sql()<
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
    where v.source_id = ${sourceId} and v.client_id = ${clientId}
    order by v.id
    limit 300`;
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
  // A deleted client reads as no client, as the old cascade (set null) did.
  const [row] = await sql()<ThreadRow[]>`
    select t.id, t.owner, c.id as client_id, t.title, t.created_at, t.updated_at
    from client_manager.threads t
    left join client_manager.clients c on c.id = t.client_id and c.deleted_at is null
    where t.id = ${id} and t.deleted_at is null`;
  return row ?? null;
}

export async function listThreads(owner: Owner) {
  return sql()<
    (ThreadRow & { client_name: string | null; preview: string | null })[]
  >`
    select t.id, t.owner, c.id as client_id, t.title, t.created_at, t.updated_at,
      c.name as client_name,
      (select m.content from client_manager.messages m
        where m.thread_id = t.id and m.role = 'assistant'
        order by m.created_at desc limit 1) as preview
    from client_manager.threads t
    left join client_manager.clients c on c.id = t.client_id and c.deleted_at is null
    where t.owner = ${owner} and t.deleted_at is null
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

/** Marks a Thread deleted; the purge cron removes it (and its messages) after 30 days. */
export async function deleteThread(id: string) {
  await sql()`
    update client_manager.threads set deleted_at = now()
    where id = ${id} and deleted_at is null`;
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

export async function addThreadMessage(
  input: {
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
  },
  db: Db = sql(),
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into client_manager.messages
      (thread_id, client_id, owner, role, mode, content, traversal, proposal, build_id, visitor_hash)
    values (${input.threadId}, ${input.clientId}, ${input.owner}, ${input.role}, ${input.mode},
      ${input.content}, ${input.traversal ? sql().json(input.traversal as never) : null},
      ${input.proposal ? sql().json(input.proposal as never) : null},
      ${input.buildId ?? null}, ${input.visitorHash})
    returning id`;
  if (!row) throw new Error("Message was not saved");
  await db`update client_manager.threads set updated_at = now() where id = ${input.threadId}`;
  return row.id;
}

/**
 * A Thread's messages, only when the Thread is the Owner's, so they can be
 * read beside the Thread's own row instead of after it.
 */
export async function threadMessages(threadId: string, owner: Owner) {
  if (!isUuid(threadId)) return [];
  return sql()<ThreadMessageRow[]>`
    select m.id, m.role, m.mode, m.content, m.client_id, m.traversal, m.proposal,
      m.build_id, m.created_at
    from client_manager.messages m
    join client_manager.threads t on t.id = m.thread_id
    where m.thread_id = ${threadId} and t.owner = ${owner} and t.deleted_at is null
    order by m.created_at, m.role desc
    limit 300`;
}

/** The Thread's last messages, only when the Thread is the Owner's own. */
export async function threadHistory(
  threadId: string,
  owner: Owner,
  limit = 10,
) {
  const rows = await sql()<{ role: "user" | "assistant"; content: string }[]>`
    select m.role, m.content from client_manager.messages m
    join client_manager.threads t on t.id = m.thread_id
    where m.thread_id = ${threadId} and t.owner = ${owner} and t.deleted_at is null
    order by m.created_at desc limit ${limit}`;
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

export async function setProposal(messageId: string, proposal: unknown) {
  await sql()`
    update client_manager.messages set proposal = ${sql().json(proposal as never)}
    where id = ${messageId}`;
}
