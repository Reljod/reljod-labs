import { parseOwner } from "@/features/access/domain/owner";
import type { BuildEventInput, JobId, SourceView } from "../../domain/events";
import {
  type AppliedRepair,
  applyRepairs,
  automaticRepairs,
  type DraftGraph,
  describeRepair,
  type Extraction,
  emptyGraph,
  graphStats,
  type Issue,
  mergeExtraction,
  nodeText,
  ROOT_KEY,
  validateGraph,
} from "../../domain/graph";
import type { GatheredSource } from "../gather";
import type { CallContext } from "../llm";
import type {
  BuildEmitter,
  BuildGraphStore,
  BuildInput,
  Critic,
  Embedder,
  Extractor,
  Files,
  Painter,
  PersonaWriter,
} from "../ports";

export type BuildWorkPorts = {
  store: BuildGraphStore;
  /** Turns one stored Source into the text the extractor reads (null: the model reads the file). */
  read: (source: {
    kind: GatheredSource["kind"];
    name: string;
    storagePath: string | null;
    text: string | null;
  }) => Promise<string | null>;
  extractor: Extractor;
  critic: Critic;
  persona: PersonaWriter;
  painter: Painter;
  embedder: Embedder;
  files: Pick<Files, "upload" | "signedUrl">;
  events: BuildEmitter;
  now: () => number;
};

/**
 * One Build's work, a method per workflow step (`build-workflow.ts` keeps
 * the steps, whose names are replay keys, and calls these). Gather, Extract
 * each Source, then review rounds of Check, Critique and Repair, then
 * Commit, Embed and Persona. Every Job reports to the Build's event stream.
 */
export interface BuildWork {
  gather(input: BuildInput): Promise<{
    clientName: string;
    sources: GatheredSource[];
    base: DraftGraph;
  }>;
  extract(
    input: BuildInput,
    clientName: string,
    source: GatheredSource,
    known: string,
  ): Promise<Extraction>;
  /** Joins every Source's facts in a fixed order, so a retry merges the same way. */
  merge(
    base: DraftGraph,
    sources: GatheredSource[],
    extractions: Extraction[],
    started: number,
  ): Promise<DraftGraph>;
  /** Code's own checks, then the fixes code can make without asking. */
  check(
    input: BuildInput,
    graph: DraftGraph,
    sources: GatheredSource[],
    round: number,
  ): Promise<{ graph: DraftGraph; issues: Issue[]; applied: number }>;
  critique(
    input: BuildInput,
    clientName: string,
    graph: DraftGraph,
    sources: GatheredSource[],
    issues: Issue[],
    round: number,
    earlier: string[],
  ): Promise<{
    graph: DraftGraph;
    verdict: "clean" | "needs_changes";
    applied: string[];
  }>;
  /**
   * The last word: reconnect anything a Repair left floating, and drop facts
   * no Source supports that the Critic didn't vouch for.
   */
  settle(
    input: BuildInput,
    graph: DraftGraph,
    sources: GatheredSource[],
    round: number,
  ): Promise<{ graph: DraftGraph; applied: number }>;
  commit(input: BuildInput, graph: DraftGraph): Promise<void>;
  embed(input: BuildInput): Promise<void>;
  persona(
    input: BuildInput,
    clientName: string,
    graph: DraftGraph,
  ): Promise<void>;
  finish(
    input: BuildInput,
    graph: DraftGraph,
    rounds: number,
    repairs: number,
  ): Promise<void>;
  fail(input: BuildInput, message: string): Promise<void>;
}

const contextOf = (input: BuildInput): CallContext => ({
  clientId: input.clientId,
  buildId: input.buildId,
  visitorHash: input.visitorHash,
});

const job = (
  name: JobId,
  state: "start" | "done" | "error" | "skip",
  extra: { detail?: string; ms?: number; round?: number } = {},
): BuildEventInput => ({ type: "job", job: name, state, ...extra });

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : /(ch|sh|s|x)$/.test(word) ? "es" : "s"}`;

export function createBuildWork(ports: BuildWorkPorts): BuildWork {
  const { store, events } = ports;
  const emit = events.emit;
  const now = ports.now;

  async function recordAndReplay(
    input: BuildInput,
    round: number,
    applied: AppliedRepair[],
  ) {
    await store.recordRepairs(input.buildId, round, applied);
    if (applied.length > 0)
      await emit(
        ...applied.map(
          (repair): BuildEventInput => ({ type: "repair", round, repair }),
        ),
      );
  }

  return {
    async gather(input) {
      const started = now();
      // The status, the client and the Sources: independent, so together.
      const [, client, rows] = await Promise.all([
        store.updateBuild(input.buildId, { status: "running" }),
        store.client(input.clientId),
        store.sourcesOfBuild(input.buildId),
        emit(job("gather", "start")),
      ]);
      if (!client) throw new Error("Client not found");
      // Every file is read at once; the events still go out in order.
      const texts = await Promise.all(
        rows.map((row) =>
          ports
            .read({
              kind: row.kind,
              name: row.name,
              storagePath: row.storage_path,
              text: row.text,
            })
            .catch((error: unknown) => {
              throw new Error(
                `Could not read ${row.name}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }),
        ),
      );
      // The text read from files, in one statement.
      await store.setSourceTexts(
        rows.flatMap((row, index) => {
          const text = texts[index] ?? null;
          return row.kind !== "note" && text !== null && text !== row.text
            ? [{ id: row.id, text }]
            : [];
        }),
      );
      const sources: GatheredSource[] = rows.map((row, index) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        mediaType: row.media_type,
        storagePath: row.storage_path,
        text: texts[index] ?? null,
      }));
      await emit(
        ...sources.flatMap((source): BuildEventInput[] => {
          const view: SourceView = {
            id: source.id,
            name: source.name,
            kind: source.kind,
            mediaType: source.mediaType,
            chars: source.text?.length ?? 0,
          };
          return [
            { type: "source", source: view },
            {
              type: "log",
              level: "info",
              text: `read ${source.name} · ${source.text === null ? "the model will look at it" : `${source.text.length.toLocaleString("en-US")} chars`}`,
            },
          ];
        }),
      );
      // An addition builds on what is already committed; an Intake starts from the client alone.
      const base =
        input.trigger === "addition"
          ? await store.loadGraph(input.clientId)
          : emptyGraph(client.name);
      await emit(
        job("gather", "done", {
          ms: now() - started,
          detail: plural(sources.length, "Source"),
        }),
        job("extract", "start", {
          detail: `${plural(sources.length, "Source")} in parallel`,
        }),
      );
      return { clientName: client.name, sources, base };
    },

    async extract(input, clientName, source, known) {
      const started = now();
      const { extraction, usage } = await ports.extractor.extract({
        context: contextOf(input),
        clientName,
        source,
        known,
        onNode: (node) => emit({ type: "node", node, sourceId: source.id }),
        onEdge: (edge) => emit({ type: "edge", edge, sourceId: source.id }),
      });
      await emit(
        { type: "usage", usage },
        {
          type: "log",
          level: "info",
          text: `${source.name}: ${plural(extraction.entities.length, "fact")}, ${plural(extraction.relations.length, "link")} (${((now() - started) / 1000).toFixed(1)}s)`,
        },
      );
      return extraction;
    },

    async merge(base, sources, extractions, started) {
      let graph = base;
      sources.forEach((source, index) => {
        const extraction = extractions[index];
        if (extraction)
          graph = mergeExtraction(graph, extraction, source.id).graph;
      });
      const stats = graphStats(graph);
      await emit(
        job("extract", "done", {
          ms: now() - started,
          detail: `${plural(stats.nodes, "Node")}, ${plural(stats.edges, "Edge")}`,
        }),
        {
          type: "log",
          level: "info",
          text: "merged duplicate mentions across Sources",
        },
      );
      return graph;
    },

    async check(input, graph, sources, round) {
      const started = now();
      await emit(job("check", "start", { round }));
      const issues = validateGraph(graph, sources);
      await emit({ type: "issues", round, issues });
      const fixed = applyRepairs(
        graph,
        automaticRepairs(graph, issues),
        "check",
      );
      await recordAndReplay(input, round, fixed.applied);
      const remaining = validateGraph(fixed.graph, sources);
      await emit(
        job("check", "done", {
          round,
          ms: now() - started,
          detail:
            issues.length === 0
              ? "no issues"
              : `${plural(issues.length, "issue")} · fixed ${fixed.applied.length} itself`,
        }),
      );
      return {
        graph: fixed.graph,
        issues: remaining,
        applied: fixed.applied.length,
      };
    },

    async critique(input, clientName, graph, sources, issues, round, earlier) {
      const started = now();
      await emit(job("critique", "start", { round }));
      const review = await ports.critic.critique({
        context: contextOf(input),
        clientName,
        graph,
        sources,
        issues,
        round,
        earlier,
      });
      await emit(
        { type: "usage", usage: review.usage },
        job("critique", "done", {
          round,
          ms: now() - started,
          detail:
            review.repairs.length === 0
              ? "looks right"
              : `${plural(review.repairs.length, "Repair")} proposed`,
        }),
      );
      if (review.notes)
        await emit({
          type: "log",
          level: "info",
          text: `critic: ${review.notes}`,
        });

      const repairStarted = now();
      await emit(job("repair", "start", { round }));
      const fixed = applyRepairs(graph, review.repairs, "critic");
      await recordAndReplay(input, round, fixed.applied);
      if (fixed.skipped.length > 0) {
        await emit({
          type: "log",
          level: "warn",
          text: `skipped ${plural(fixed.skipped.length, "Repair")} that named Nodes not in the graph`,
        });
      }
      await emit(
        job("repair", "done", {
          round,
          ms: now() - repairStarted,
          detail:
            fixed.applied.length === 0
              ? "nothing to change"
              : `applied ${fixed.applied.length}`,
        }),
      );
      return {
        graph: fixed.graph,
        verdict: review.verdict,
        applied: fixed.applied.map(describeRepair),
      };
    },

    async settle(input, graph, sources, round) {
      const issues = validateGraph(graph, sources);
      const doubtful = issues
        .filter(
          (issue) =>
            issue.kind === "unsupported" && !issue.target.includes("|"),
        )
        .flatMap((issue) => {
          const node = graph.nodes.find((item) => item.key === issue.target);
          return node && node.key !== ROOT_KEY && node.confidence < 0.5
            ? [node]
            : [];
        });
      const first = applyRepairs(
        graph,
        doubtful.map((node) => ({
          op: "remove_node" as const,
          key: node.key,
          reason: `Dropped ${node.label}: no Source says it and it was read with low confidence`,
        })),
        "check",
      );
      const after = validateGraph(first.graph, sources);
      const second = applyRepairs(
        first.graph,
        automaticRepairs(first.graph, after),
        "check",
      );
      const applied = [...first.applied, ...second.applied];
      await recordAndReplay(input, round, applied);
      return { graph: second.graph, applied: applied.length };
    },

    async commit(input, graph) {
      const started = now();
      await emit(job("commit", "start"));
      await store.commitGraph(input.clientId, graph);
      const stats = graphStats(graph);
      await emit(
        job("commit", "done", {
          ms: now() - started,
          detail: `${plural(stats.nodes, "Node")}, ${plural(stats.edges, "Edge")} in client_manager.nodes / edges`,
        }),
      );
    },

    async embed(input) {
      const started = now();
      await emit(job("embed", "start"));
      const pending = await store.nodesWithoutEmbedding(input.clientId);
      const { embeddings, usage } = await ports.embedder.embed(
        contextOf(input),
        pending.map(nodeText),
      );
      const rows = pending
        .map((node, index) => ({
          id: node.id,
          embedding: embeddings[index] ?? [],
        }))
        .filter((row) => row.embedding.length > 0);
      await store.setEmbeddings(rows);
      if (usage) await emit({ type: "usage", usage });
      await emit(
        job("embed", "done", {
          ms: now() - started,
          detail:
            pending.length === 0
              ? "already indexed"
              : rows.length === 0
                ? `${plural(pending.length, "Node")} left to full-text search`
                : `${plural(rows.length, "Node")} → vector(768), HNSW`,
        }),
      );
    },

    async persona(input, clientName, graph) {
      const started = now();
      const context = contextOf(input);
      const [{ persona, usage }, client] = await Promise.all([
        ports.persona.infer({ context, clientName, graph }),
        store.client(input.clientId),
        emit(job("persona", "start")),
      ]);
      await store.setPersona(input.clientId, persona);
      await emit({ type: "usage", usage }, { type: "persona", persona });

      let detail = persona.archetype;
      if (client && !client.portrait_path) {
        try {
          const portrait = await ports.painter.paint(
            context,
            persona.portraitPrompt,
          );
          const path = `clients/${input.clientId}/portrait-${input.buildId}.jpg`;
          await ports.files.upload(path, portrait.image, portrait.mediaType);
          const [url] = await Promise.all([
            ports.files.signedUrl(path),
            store.setPortrait(input.clientId, path, "generated"),
          ]);
          await emit({ type: "usage", usage: portrait.usage });
          if (url) await emit({ type: "portrait", url });
          detail = `${persona.archetype} · portrait painted`;
        } catch (error) {
          // A missing portrait never fails the Build; the card falls back to initials.
          await emit({
            type: "log",
            level: "warn",
            text: `portrait skipped: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      await emit(job("persona", "done", { ms: now() - started, detail }));
    },

    async finish(input, graph, rounds, repairs) {
      // Independent reads, together.
      const [build, spend, client] = await Promise.all([
        store.build(input.buildId),
        store.buildSpend(input.buildId),
        store.client(input.clientId),
      ]);
      const stats = {
        ...graphStats(graph),
        repairs,
        rounds,
        costUsd: spend.cost,
        tokens: spend.tokens,
        ms: build ? now() - build.created_at.getTime() : 0,
      };
      await Promise.all([
        store.updateBuild(input.buildId, { status: "completed", stats }),
        store.setClientStatus(input.clientId, "ready"),
        store.addMessage({
          clientId: input.clientId,
          owner: parseOwner(client?.owner),
          role: "assistant",
          mode: "build",
          content: `Graph ${input.trigger === "addition" ? "updated" : "ready"}: ${plural(stats.nodes, "Node")} and ${plural(stats.edges, "Edge")} across ${plural(stats.branches, "Branch")}, after ${plural(repairs, "Repair")} in ${plural(rounds, "review round")}.`,
          buildId: input.buildId,
          visitorHash: input.visitorHash,
        }),
      ]);
      await emit({ type: "end", status: "completed", stats });
      await events.close();
    },

    async fail(input, message) {
      await store.updateBuild(input.buildId, {
        status: "failed",
        error: message,
      });
      if (input.trigger === "intake")
        await store.setClientStatus(input.clientId, "failed");
      await emit(
        { type: "log", level: "error", text: message },
        { type: "end", status: "failed", error: message },
      );
      await events.close();
    },
  };
}
