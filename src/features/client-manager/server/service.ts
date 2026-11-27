import "server-only";
import { getRun, start } from "workflow/api";
import { z } from "zod";
import type { Owner } from "@/features/access/domain/owner";
import { MAX_PROPOSED_FACTS } from "../domain/chat";
import type {
  BuildEvent,
  BuildStats,
  Persona,
  SourceKind,
  SourceView,
} from "../domain/events";
import { safeExtension } from "../domain/file-name";
import { slugify } from "../domain/graph";
import { LIMITS, type LimitKind, refusalFor } from "../domain/limits";
import { buildWorkflow } from "./build-workflow";
import { sql } from "./db";
import { kindOf, mediaTypeFor } from "./gather";
import {
  addMessage,
  type BuildRow,
  type CatalogRow,
  type ClientRow,
  canView,
  claimBuild,
  clientStats,
  clientsToPurge,
  createBuild,
  createClientRow,
  createSources,
  type Db,
  deleteClient,
  type EdgeScope,
  edgesInScope,
  factsPerSource,
  getBuild,
  getClient,
  latestBuild,
  listCatalog,
  nodeDetail,
  nodesLite,
  purgeClient,
  setClientStatus,
  setPortrait,
  sourceDetail,
  sourcesOfClient,
  updateBuild,
  usageFor,
} from "./repository";
import { currentOwner, type Visitor } from "./session";
import {
  removeFolder,
  sampleUrl,
  sampleUrls,
  signedUrl,
  signedUrls,
  uploadUrl,
} from "./storage";

export { LIMITS };

export class LimitError extends Error {}

export const fileSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.string().max(120),
  size: z.number().int().min(1).max(LIMITS.fileBytes),
});

export const intakeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  note: z.string().max(LIMITS.noteChars).default(""),
  files: z.array(fileSchema).max(LIMITS.files).default([]),
  portrait: fileSchema.nullable().default(null),
  sample: z.boolean().default(false),
});

export const additionSchema = z.object({
  note: z.string().max(LIMITS.noteChars).default(""),
  files: z.array(fileSchema).max(LIMITS.files).default([]),
});

/**
 * Checks the caps without taking a place: for paid work that adds no Build
 * or question row (painting a portrait), where spend is the cap that counts.
 */
export async function checkLimits(
  visitor: Visitor,
  kind: LimitKind,
  owner: string | null,
) {
  if (visitor.trusted) return;
  const usage = await usageFor(sql(), {
    visitorHash: visitor.hash,
    owner,
  });
  const refusal = refusalFor(kind, usage);
  if (refusal) throw new LimitError(refusal);
}

/**
 * Takes one place under the caps and writes the row that holds it (a Build,
 * a question) in the same transaction, or throws a LimitError. The count and
 * the insert run under advisory locks on the visitor, the Owner and the
 * kind's global cap, always taken in that order, so two requests at once
 * cannot both take the last place. Called before any model call.
 */
export async function takeLimit<T>(
  visitor: Visitor,
  owner: string | null,
  kind: LimitKind,
  work: (db: Db) => Promise<T>,
): Promise<T> {
  if (visitor.trusted) return work(sql());
  const global = kind === "build" ? "build" : "ask";
  return (await sql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`cm:visitor:${visitor.hash}`}, 0))`;
    if (owner)
      await tx`select pg_advisory_xact_lock(hashtextextended(${`cm:owner:${owner}`}, 0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`cm:all:${global}`}, 0))`;
    const usage = await usageFor(tx, { visitorHash: visitor.hash, owner });
    const refusal = refusalFor(kind, usage);
    if (refusal) throw new LimitError(refusal);
    return work(tx);
  })) as T;
}

type Upload = { sourceId: string; name: string; url: string };

function fileSources(
  clientId: string,
  buildId: string,
  files: z.infer<typeof fileSchema>[],
) {
  return files.map((file, index) => {
    const kind = kindOf(file.name, file.type);
    if (!kind)
      throw new LimitError(
        `${file.name}: use PDF, images, xlsx, csv, docx, txt or md.`,
      );
    const extension = safeExtension(file.name, "bin");
    const stem = slugify(file.name.replace(/\.[^.]+$/, "")) || "file";
    return {
      clientId,
      buildId,
      kind,
      name: file.name,
      mediaType: mediaTypeFor(kind, file.name, file.type),
      storagePath: `clients/${clientId}/sources/${buildId}/${index}-${stem}.${extension}`,
      byteSize: file.size,
      text: null,
    };
  });
}

function assertSomething(note: string, files: unknown[]) {
  if (!note.trim() && files.length === 0) {
    throw new LimitError("Add a note or at least one file.");
  }
}

/** The Build's Sources and their upload links; the Build row is already in (`takeLimit`). */
async function prepareBuild(input: {
  clientId: string;
  buildId: string;
  trigger: "intake" | "addition";
  note: string;
  files: z.infer<typeof fileSchema>[];
}): Promise<{ buildId: string; uploads: Upload[] }> {
  const note = input.note.trim();
  const { buildId } = input;
  const rows = [
    ...(note
      ? [
          {
            clientId: input.clientId,
            buildId,
            kind: "note" as SourceKind,
            name: input.trigger === "intake" ? "Intake note" : "Added note",
            mediaType: "text/plain",
            storagePath: null,
            byteSize: note.length,
            text: note,
          },
        ]
      : []),
    ...fileSources(input.clientId, buildId, input.files),
  ];
  const sources = await createSources(rows);
  const uploads: Upload[] = [];
  for (const source of sources) {
    if (!source.storage_path) continue;
    uploads.push({
      sourceId: source.id,
      name: source.name,
      url: await uploadUrl(source.storage_path),
    });
  }
  return { buildId, uploads };
}

export async function createIntake(
  raw: unknown,
  visitor: Visitor,
  owner: Owner,
) {
  const input = intakeSchema.parse(raw);
  assertSomething(input.note, input.files);
  const isSample = input.sample && visitor.trusted;
  const created = await takeLimit(visitor, owner, "build", async (db) => {
    const clientId = await createClientRow(
      {
        name: input.name,
        owner: isSample ? null : owner,
        isSample,
        visitorHash: visitor.hash,
      },
      db,
    );
    const buildId = await createBuild(
      { clientId, trigger: "intake", visitorHash: visitor.hash },
      db,
    );
    return { clientId, buildId };
  });
  const { clientId } = created;
  const { buildId, uploads } = await prepareBuild({
    clientId,
    buildId: created.buildId,
    trigger: "intake",
    note: input.note,
    files: input.files,
  });
  let portraitUpload: { url: string } | null = null;
  if (input.portrait) {
    const extension = safeExtension(input.portrait.name, "jpg");
    const path = `clients/${clientId}/portrait-uploaded.${extension}`;
    portraitUpload = { url: await uploadUrl(path) };
    await setPortrait(clientId, path, "uploaded");
  }
  const summary = [
    input.note.trim()
      ? `a ${input.note.trim().length.toLocaleString("en-US")}-character note`
      : null,
    input.files.length > 0
      ? `${input.files.length} file${input.files.length === 1 ? "" : "s"} (${input.files.map((file) => file.name).join(", ")})`
      : null,
  ]
    .filter(Boolean)
    .join(" and ");
  await addMessage({
    clientId,
    owner: isSample ? null : owner,
    role: "user",
    mode: "build",
    content: `New client: ${input.name}. Built from ${summary}.`,
    buildId,
    visitorHash: visitor.hash,
  });
  return { clientId, buildId, uploads, portraitUpload };
}

export async function createAddition(
  client: ClientRow,
  raw: unknown,
  visitor: Visitor,
  owner: Owner,
  /** False when the chat already shows the person's words. */
  announce = true,
) {
  const input = additionSchema.parse(raw);
  assertSomething(input.note, input.files);
  await assertAddable(client, visitor);
  const created = await takeLimit(visitor, owner, "build", (db) =>
    createBuild(
      { clientId: client.id, trigger: "addition", visitorHash: visitor.hash },
      db,
    ),
  );
  const { buildId, uploads } = await prepareBuild({
    clientId: client.id,
    buildId: created,
    trigger: "addition",
    note: input.note,
    files: input.files,
  });
  if (!announce) return { buildId, uploads };
  const parts = [
    input.note.trim(),
    input.files.length > 0
      ? `📎 ${input.files.map((file) => file.name).join(", ")}`
      : "",
  ].filter(Boolean);
  await addMessage({
    clientId: client.id,
    owner: client.owner ? owner : null,
    role: "user",
    mode: "build",
    content: parts.join("\n"),
    buildId,
    visitorHash: visitor.hash,
  });
  return { buildId, uploads };
}

/** Throws unless a new addition may start on this client now. */
async function assertAddable(client: ClientRow, visitor: Visitor) {
  if (client.is_sample && !visitor.trusted) {
    throw new LimitError(
      "Sample clients are read-only. Add your own client to try additions.",
    );
  }
  const running = await latestBuild(client.id);
  if (running && isAbandoned(running)) {
    // Its browser never started it (an upload failed, the tab closed).
    await updateBuild(running.id, { status: "failed", error: "Never started" });
  } else if (running && ["queued", "running"].includes(running.status)) {
    throw new LimitError("A build is already running for this client.");
  }
}

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => /^https?:\/\/[^\s]+$/i.test(value),
    "Links must be http(s)",
  );

export const factsSchema = z.object({
  facts: z
    .array(
      z.object({
        text: z.string().trim().min(3).max(500),
        sourceUrl: httpUrl.nullish(),
        sourceTitle: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1)
    .max(MAX_PROPOSED_FACTS),
});

/**
 * Adds facts the person approved (from web research) or told the chat, as
 * one Source and an addition Build: the same pipeline as an Intake, so they
 * are checked, deduplicated and reviewed before they land in the graph.
 */
export async function addFacts(
  client: ClientRow,
  raw: unknown,
  visitor: Visitor,
  origin: "research" | "chat",
): Promise<{ buildId: string }> {
  const { facts } = factsSchema.parse(raw);
  await assertAddable(client, visitor);
  const buildId = await takeLimit(visitor, client.owner, "build", (db) =>
    createBuild(
      { clientId: client.id, trigger: "addition", visitorHash: visitor.hash },
      db,
    ),
  );
  const linked = facts.some((fact) => fact.sourceUrl);
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const text = facts
    .map((fact) =>
      fact.sourceUrl
        ? `- ${fact.text} (Source: ${fact.sourceTitle ? `${fact.sourceTitle}, ` : ""}${fact.sourceUrl})`
        : `- ${fact.text}`,
    )
    .join("\n");
  await createSources([
    {
      clientId: client.id,
      buildId,
      kind: linked ? "web" : "note",
      name:
        origin === "research"
          ? `Web research · ${date}`
          : `From chat · ${date}`,
      mediaType: "text/plain",
      storagePath: null,
      byteSize: text.length,
      text,
    },
  ]);
  const build = await getBuild(buildId);
  if (build) await startBuild(build, visitor);
  return { buildId };
}

/** Starts the Build's workflow once the browser has uploaded its files. */
export async function startBuild(build: BuildRow, visitor: Visitor) {
  if (!(await claimBuild(build.id))) return;
  try {
    const run = await start(buildWorkflow, [
      {
        buildId: build.id,
        clientId: build.client_id,
        visitorHash: visitor.hash,
        trigger: build.trigger,
      },
    ]);
    await updateBuild(build.id, { workflowRunId: run.runId });
  } catch (error) {
    await updateBuild(build.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** How long a Build may wait for its browser to call `/start`. */
const START_GRACE_MS = 5 * 60 * 1000;

function isAbandoned(build: BuildRow) {
  return (
    build.status === "queued" &&
    !build.workflow_run_id &&
    Date.now() - build.created_at.getTime() > START_GRACE_MS
  );
}

/**
 * Deletes a Client: stops a Build still going and marks the client deleted,
 * so no read sees it again. Their rows and Storage files stay for 30 days
 * and go in `purgeDeletedClients`; a person's delete never removes data on
 * the spot.
 */
export async function removeClient(client: ClientRow) {
  const build = await latestBuild(client.id);
  if (build && ["queued", "running"].includes(build.status)) {
    await stopBuild(build).catch(() => {});
  }
  await deleteClient(client.id);
}

/**
 * Purges clients deleted more than 30 days ago (or about to expire anyway):
 * their Storage folder first, then the rows, which cascade. Storage cannot
 * be emptied from SQL, so this runs from the app after a catalog read, a few
 * clients at a time; it never fails the request that started it.
 */
export async function purgeDeletedClients(limit = 5) {
  const due = await clientsToPurge(limit).catch(() => []);
  for (const { id } of due) {
    try {
      await removeFolder(`clients/${id}`);
      await purgeClient(id);
    } catch (error) {
      console.error(
        "[client-manager] purge failed",
        error instanceof Error ? error.message : "",
      );
    }
  }
}

/**
 * Stops a Build: cancels its workflow and tells whoever is watching. A model
 * call already in flight still finishes and is billed; nothing after it runs.
 */
export async function stopBuild(build: BuildRow) {
  if (!["queued", "running"].includes(build.status)) return;
  if (build.workflow_run_id) {
    const run = getRun(build.workflow_run_id);
    try {
      await run.cancel({ cancelReason: "Stopped by the person" });
    } catch {
      // Already over; the row still has to close.
    }
    try {
      const writer = run.getWritable<BuildEvent>().getWriter();
      const at = Date.now();
      await writer.write({
        at,
        type: "log",
        level: "warn",
        text: "stopped by the person",
      });
      await writer.write({
        at,
        type: "end",
        status: "stopped",
        error: "Stopped",
      });
      writer.releaseLock();
    } catch {
      // The stream is closed; watchers see the stopped row on reload.
    }
  }
  await updateBuild(build.id, {
    status: "stopped",
    error: "Stopped by the person",
  });
  if (build.trigger === "intake")
    await setClientStatus(build.client_id, "failed");
}

/** The Build, if this Owner may watch it. */
export async function viewableBuild(buildId: string, owner: Owner | null) {
  const build = await getBuild(buildId);
  if (!build) return null;
  const client = await getClient(build.client_id);
  if (!client || !canView(client, owner)) return null;
  return { build, client };
}

export async function viewableClient(clientId: string, owner: Owner | null) {
  const client = await getClient(clientId);
  return client && canView(client, owner) ? client : null;
}

/**
 * For a read route: the Access gate and the client's row, started together
 * so the gate's auth call and the lookup overlap. The row is only returned
 * once the gate has passed and only if this Owner may see it; if the gate
 * refuses, this throws its AccessDeniedError and the row is dropped.
 */
export async function gatedClient(clientId: string) {
  const [owner, client] = await Promise.all([
    currentOwner(),
    getClient(clientId),
  ]);
  return { owner, client: client && canView(client, owner) ? client : null };
}

export async function ownedClient(
  clientId: string,
  owner: Owner | null,
  visitor: Visitor,
) {
  const client = await getClient(clientId);
  if (!client) return null;
  if (client.owner && client.owner === owner) return client;
  if (client.is_sample && visitor.trusted) return client;
  return null;
}

// Views ---------------------------------------------------------------------------

export type CatalogCard = {
  id: string;
  name: string;
  isSample: boolean;
  status: ClientRow["status"];
  building: boolean;
  persona: Persona | null;
  portraitUrl: string | null;
  nodes: number;
  edges: number;
  branches: Record<string, number>;
  createdAt: string;
};

export async function catalog(owner: Owner | null): Promise<CatalogCard[]> {
  const rows = await listCatalog(owner);
  const portraits = (sample: boolean) =>
    rows.flatMap((row) =>
      row.portrait_path && row.is_sample === sample ? [row.portrait_path] : [],
    );
  // Samples' links are kept and reused; an Owner's own are signed now.
  const [shared, own] = await Promise.all([
    sampleUrls(portraits(true)),
    signedUrls(portraits(false)),
  ]);
  const urls = new Map([...own, ...shared]);
  return rows.map((row: CatalogRow) => ({
    id: row.id,
    name: row.name,
    isSample: row.is_sample,
    status: row.status,
    building:
      row.last_build_status === "queued" || row.last_build_status === "running",
    persona: row.persona,
    portraitUrl: row.portrait_path
      ? (urls.get(row.portrait_path) ?? null)
      : null,
    nodes: row.node_count,
    edges: row.edge_count,
    branches: row.branch_counts ?? {},
    createdAt: row.created_at.toISOString(),
  }));
}

export type NodeLite = {
  key: string;
  label: string;
  type: string;
  category: string;
  summary: string;
  attributes: Record<string, string>;
  confidence: number;
  sourceIds: string[];
  quotes: number;
};

export type SourceSummary = SourceView & {
  createdAt: string;
  buildId: string | null;
  facts: number;
};

/** A client as the dashboard first draws it: no Edges, no quotes; those load as you open things. */
export type ClientSummary = {
  id: string;
  name: string;
  isSample: boolean;
  status: ClientRow["status"];
  persona: Persona | null;
  portraitUrl: string | null;
  portraitSource: ClientRow["portrait_source"];
  nodes: NodeLite[];
  edgeCount: number;
  sources: SourceSummary[];
  latestBuild: {
    id: string;
    status: BuildRow["status"];
    trigger: BuildRow["trigger"];
    stats: BuildStats | null;
    error: string | null;
  } | null;
  spend: { costUsd: number; tokens: number };
  canAdd: boolean;
};

export async function clientSummary(
  client: ClientRow,
  owner: Owner | null,
  visitor: Visitor | null,
): Promise<ClientSummary> {
  // Four database queries, so they fit the pool (max 4) in one round.
  const [nodes, sources, counts, stats, portraitUrl] = await Promise.all([
    nodesLite(client.id),
    sourcesOfClient(client.id),
    factsPerSource(client.id),
    clientStats(client.id),
    client.portrait_path
      ? (client.is_sample ? sampleUrl : signedUrl)(client.portrait_path)
      : Promise.resolve(null),
  ]);
  const build = stats.build;
  const backed = new Map(counts.map((row) => [row.source_id, row.total]));
  return {
    id: client.id,
    name: client.name,
    isSample: client.is_sample,
    status: client.status,
    persona: client.persona,
    portraitUrl,
    portraitSource: client.portrait_source,
    nodes: nodes.map((node) => ({
      key: node.key,
      label: node.label,
      type: node.type,
      category: node.category,
      summary: node.summary,
      attributes: node.attributes,
      confidence: node.confidence,
      sourceIds: node.source_ids,
      quotes: node.quotes,
    })),
    edgeCount: stats.edges,
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      mediaType: source.media_type,
      chars: source.chars,
      buildId: source.build_id,
      createdAt: source.created_at.toISOString(),
      facts: backed.get(source.id) ?? 0,
    })),
    latestBuild: build
      ? {
          id: build.id,
          status: build.status,
          trigger: build.trigger,
          stats: build.stats,
          error: build.error,
        }
      : null,
    spend: { costUsd: stats.cost, tokens: stats.tokens },
    canAdd: canAdd(client, owner, visitor),
  };
}

export function canAdd(
  client: ClientRow,
  owner: Owner | null,
  visitor: Visitor | null,
) {
  return (
    (!!owner && client.owner === owner) ||
    (client.is_sample && !!visitor?.trusted)
  );
}

export type EdgeLite = {
  from: string;
  to: string;
  relation: string;
  label: string;
  confidence: number;
  quotes: number;
};

export async function clientEdges(
  clientId: string,
  scope: EdgeScope,
): Promise<EdgeLite[]> {
  const rows = await edgesInScope(clientId, scope);
  return rows.map((row) => ({
    from: row.from_key,
    to: row.to_key,
    relation: row.relation,
    label: row.label,
    confidence: row.confidence,
    quotes: row.quotes,
  }));
}

export type Quote = { sourceId: string; quote: string };

export type NodeFull = NodeLite & {
  evidence: Quote[];
  links: (EdgeLite & { evidence: Quote[] })[];
};

export async function clientNode(
  clientId: string,
  key: string,
): Promise<NodeFull | null> {
  const detail = await nodeDetail(clientId, key);
  if (!detail) return null;
  const { node, evidence, edges } = detail;
  return {
    key: node.key,
    label: node.label,
    type: node.type,
    category: node.category,
    summary: node.summary,
    attributes: node.attributes,
    confidence: node.confidence,
    sourceIds: [...new Set(evidence.map((item) => item.source_id))],
    quotes: evidence.length,
    evidence: evidence.map((item) => ({
      sourceId: item.source_id,
      quote: item.quote,
    })),
    links: edges.map((edge) => ({
      from: edge.from_key,
      to: edge.to_key,
      relation: edge.relation,
      label: edge.label,
      confidence: edge.confidence,
      quotes: edge.evidence?.length ?? 0,
      evidence: (edge.evidence ?? []).map((item) => ({
        sourceId: item.source_id,
        quote: item.quote,
      })),
    })),
  };
}

export type SourceFull = SourceSummary & {
  text: string | null;
  url: string | null;
  backing: {
    quote: string;
    key: string | null;
    label: string;
    category: string | null;
    confidence: number;
  }[];
};

export async function clientSource(
  clientId: string,
  sourceId: string,
  /** A Sample's file link is shared and kept; an Owner's is signed per request. */
  isSample = false,
): Promise<SourceFull | null> {
  const detail = await sourceDetail(clientId, sourceId);
  if (!detail) return null;
  const { source, facts } = detail;
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    mediaType: source.media_type,
    chars: source.text?.length ?? 0,
    buildId: source.build_id,
    createdAt: source.created_at.toISOString(),
    facts: facts.length,
    text: source.text,
    url: source.storage_path
      ? await (isSample ? sampleUrl : signedUrl)(source.storage_path)
      : null,
    backing: facts.map((fact) => ({
      quote: fact.quote,
      key: fact.node_key,
      label:
        fact.node_label ??
        `${fact.from_label ?? ""} ${fact.edge_label ?? ""} ${fact.to_label ?? ""}`.trim(),
      category: fact.category,
      confidence: fact.confidence,
    })),
  };
}
