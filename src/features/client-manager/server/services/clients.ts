import type { Owner } from "@/features/access/domain/owner";
import { InvalidError, NotFoundError } from "@/platform/errors";
import {
  type CatalogCard,
  type ClientSummary,
  type EdgeLite,
  type EdgeScope,
  isUuid,
  type NodeFull,
  type PortraitInput,
  type PortraitResponse,
  type SourceFull,
} from "../../domain/api";
import { isUploadedPortraitPath, safeExtension } from "../../domain/file-name";
import type {
  Caller,
  Caps,
  ClientStore,
  Files,
  Later,
  Painter,
} from "../ports";
import { canChange, canView } from "./scope";

export type ClientPorts = {
  clients: ClientStore;
  files: Files;
  caps: Pick<Caps, "check">;
  painter: Painter;
  later: Later;
  now: () => number;
  /** Stops the client's Build still going (the Build service's `haltLatest`). */
  halt: (clientId: string) => Promise<void>;
};

/**
 * The Catalog and the Client file. Every read is scoped here: a Sample to
 * everyone, anyone else's client only to its Owner, and a client someone may
 * not see answers exactly like one that is not there. The lookup and the
 * read it guards run together (one database round); the read is returned
 * only once the lookup allows it.
 */
export interface ClientService {
  catalog(owner: Owner): Promise<CatalogCard[]>;
  file(caller: Caller, clientId: string): Promise<ClientSummary>;
  /** `shared` is true for a Sample, whose answer the browser may keep a while. */
  edges(
    owner: Owner,
    clientId: string,
    scope: EdgeScope,
  ): Promise<{ edges: EdgeLite[]; shared: boolean }>;
  node(
    owner: Owner,
    clientId: string,
    key: string,
  ): Promise<{ node: NodeFull; shared: boolean }>;
  source(owner: Owner, clientId: string, sourceId: string): Promise<SourceFull>;
  /** A soft delete: stops a Build still going, then hides the client from every read. */
  remove(caller: Caller, clientId: string): Promise<void>;
  /** Upload (two steps) or paint the client's Portrait. Painting takes the `build` cap first. */
  portrait(
    caller: Caller,
    clientId: string,
    input: PortraitInput,
  ): Promise<PortraitResponse>;
}

const gone = () => new NotFoundError("This client is gone, or isn't yours.");

export function createClientService(ports: ClientPorts): ClientService {
  const { clients, files } = ports;

  /** Clients deleted 30 days ago leave Storage first, then their rows; never fails a request. */
  async function purgeDeleted(limit = 5) {
    const due = await clients.toPurge(limit).catch(() => []);
    for (const { id } of due) {
      try {
        await files.removeFolder(`clients/${id}`);
        await clients.purge(id);
      } catch (error) {
        console.error(
          "[client-manager] purge failed",
          error instanceof Error ? error.message : "",
        );
      }
    }
  }

  /** The row and the read it guards, together; the read only if the Owner may see the client. */
  async function guarded<T>(
    owner: Owner,
    clientId: string,
    read: () => Promise<T>,
  ) {
    if (!isUuid(clientId)) throw gone();
    const [client, value] = await Promise.all([clients.get(clientId), read()]);
    if (!client || !canView(client, owner)) throw gone();
    return { client, value };
  }

  const signFor = (sample: boolean) =>
    sample ? files.sampleUrl : files.signedUrl;

  return {
    async catalog(owner) {
      const rows = await clients.catalog(owner);
      // Storage cannot be emptied from SQL, so deleted clients leave after a read.
      ports.later(() => purgeDeleted());
      const portraits = (sample: boolean) =>
        rows.flatMap((row) =>
          row.portrait_path && row.is_sample === sample
            ? [row.portrait_path]
            : [],
        );
      // Samples' links are kept and reused; an Owner's own are signed now.
      const [shared, own] = await Promise.all([
        files.sampleUrls(portraits(true)),
        files.signedUrls(portraits(false)),
      ]);
      const urls = new Map([...own, ...shared]);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        isSample: row.is_sample,
        status: row.status,
        building:
          row.last_build_status === "queued" ||
          row.last_build_status === "running",
        persona: row.persona,
        portraitUrl: row.portrait_path
          ? (urls.get(row.portrait_path) ?? null)
          : null,
        nodes: row.node_count,
        edges: row.edge_count,
        branches: row.branch_counts ?? {},
        createdAt: row.created_at.toISOString(),
      }));
    },

    async file(caller, clientId) {
      const row = await clients.file(clientId);
      if (!row || !canView(row, caller.owner)) throw gone();
      const portraitUrl = row.portrait_path
        ? await signFor(row.is_sample)(row.portrait_path)
        : null;
      return {
        id: row.id,
        name: row.name,
        isSample: row.is_sample,
        status: row.status,
        persona: row.persona,
        portraitUrl,
        portraitSource: row.portrait_source,
        nodes: row.nodes.map((node) => ({
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
        edgeCount: row.edges,
        sources: row.sources.map((source) => ({
          id: source.id,
          name: source.name,
          kind: source.kind,
          mediaType: source.media_type,
          chars: source.chars,
          buildId: source.build_id,
          createdAt: new Date(source.created_at).toISOString(),
          facts: source.facts,
        })),
        latestBuild: row.build
          ? {
              id: row.build.id,
              status: row.build.status,
              trigger: row.build.trigger,
              stats: row.build.stats,
              error: row.build.error,
            }
          : null,
        spend: { costUsd: row.cost, tokens: row.tokens },
        canAdd: canChange(row, caller),
      };
    },

    async edges(owner, clientId, scope) {
      const { client, value } = await guarded(owner, clientId, () =>
        clients.edges(clientId, scope),
      );
      return {
        shared: client.is_sample,
        edges: value.map((row) => ({
          from: row.from_key,
          to: row.to_key,
          relation: row.relation,
          label: row.label,
          confidence: row.confidence,
          quotes: row.quotes,
        })),
      };
    },

    async node(owner, clientId, key) {
      const { client, value: detail } = await guarded(owner, clientId, () =>
        clients.node(clientId, key),
      );
      if (!detail) throw new NotFoundError("That fact is gone.");
      const { node, evidence, edges } = detail;
      return {
        shared: client.is_sample,
        node: {
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
        },
      };
    },

    async source(owner, clientId, sourceId) {
      const { client, value: detail } = await guarded(owner, clientId, () =>
        clients.source(clientId, sourceId),
      );
      if (!detail) throw new NotFoundError("That document is gone.");
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
        // A Sample's file link is shared and kept; an Owner's is signed per request.
        url: source.storage_path
          ? await signFor(client.is_sample)(source.storage_path)
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
    },

    async remove(caller, clientId) {
      const client = await clients.get(clientId);
      if (!client || !canChange(client, caller)) throw gone();
      await ports.halt(client.id);
      await clients.remove(client.id);
    },

    async portrait(caller, clientId, input) {
      const client = await clients.get(clientId);
      if (!client || !canChange(client, caller)) throw gone();

      if (input.mode === "upload") {
        const extension = safeExtension(input.name, "jpg");
        const path = `clients/${client.id}/portrait-uploaded-${ports.now()}.${extension}`;
        return { path, url: await files.uploadUrl(path) };
      }

      if (input.mode === "confirm") {
        if (!isUploadedPortraitPath(client.id, input.path))
          throw new InvalidError("That isn't this client's upload.");
        if (!(await files.exists(input.path)))
          throw new InvalidError("That upload hasn't arrived. Try again.");
        await clients.setPortrait(client.id, input.path, "uploaded");
        return { url: await files.signedUrl(input.path) };
      }

      const prompt = client.persona?.portraitPrompt;
      if (!prompt)
        throw new InvalidError(
          "The portrait is painted once the graph has a Persona.",
        );
      // The cap before the image model: painting is paid.
      await ports.caps.check(caller.visitor, "build", client.owner);
      const portrait = await ports.painter.paint(
        {
          clientId: client.id,
          buildId: null,
          visitorHash: caller.visitor.hash,
        },
        prompt,
      );
      const path = `clients/${client.id}/portrait-${ports.now()}.jpg`;
      await files.upload(path, portrait.image, portrait.mediaType);
      await clients.setPortrait(client.id, path, "generated");
      return { url: await files.signedUrl(path), usage: portrait.usage };
    },
  };
}
