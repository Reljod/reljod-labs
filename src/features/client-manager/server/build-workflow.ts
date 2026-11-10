import { getWritable } from "workflow";
import type {
  BuildEvent,
  BuildEventInput,
  JobId,
  SourceView,
} from "../domain/events";
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
  ROOT_KEY,
  validateGraph,
} from "../domain/graph";
import { critique } from "./critic";
import { extractSource } from "./extract";
import { type GatheredSource, readSource } from "./gather";
import type { CallContext } from "./llm";
import { embedTexts, inferPersona, nodeText, paintPortrait } from "./persona";
import {
  addMessage,
  buildSpend,
  commitGraph,
  getBuild,
  getClient,
  loadGraph,
  nodesWithoutEmbedding,
  recordRepairs,
  setClientStatus,
  setEmbeddings,
  setPersona,
  setPortrait,
  setSourceText,
  sourcesOfBuild,
  updateBuild,
} from "./repository";
import { signedUrl, upload } from "./storage";

/** Review rounds: check, critique, repair; then again if the Critic changed anything. */
export const MAX_ROUNDS = 2;

export type BuildInput = {
  buildId: string;
  clientId: string;
  visitorHash: string;
  trigger: "intake" | "addition";
};

const contextOf = (input: BuildInput): CallContext => ({
  clientId: input.clientId,
  buildId: input.buildId,
  visitorHash: input.visitorHash,
});

async function emit(...events: BuildEventInput[]) {
  const writer = getWritable<BuildEvent>().getWriter();
  try {
    for (const event of events) {
      await writer.write({ ...event, at: Date.now() } as BuildEvent);
    }
  } finally {
    writer.releaseLock();
  }
}

const job = (
  name: JobId,
  state: "start" | "done" | "error" | "skip",
  extra: { detail?: string; ms?: number; round?: number } = {},
): BuildEventInput => ({ type: "job", job: name, state, ...extra });

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : /(ch|sh|s|x)$/.test(word) ? "es" : "s"}`;

// Steps --------------------------------------------------------------------------

async function gatherStep(input: BuildInput): Promise<{
  clientName: string;
  sources: GatheredSource[];
  base: DraftGraph;
}> {
  "use step";
  const started = Date.now();
  await updateBuild(input.buildId, { status: "running" });
  await emit(job("gather", "start"));
  const client = await getClient(input.clientId);
  if (!client) throw new Error("Client not found");
  const rows = await sourcesOfBuild(input.buildId);
  const sources: GatheredSource[] = [];
  for (const row of rows) {
    const text = await readSource({
      kind: row.kind,
      name: row.name,
      storagePath: row.storage_path,
      text: row.text,
    }).catch((error: unknown) => {
      throw new Error(
        `Could not read ${row.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (row.kind !== "note" && text !== row.text)
      await setSourceText(row.id, text);
    const source: GatheredSource = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      mediaType: row.media_type,
      storagePath: row.storage_path,
      text,
    };
    sources.push(source);
    const view: SourceView = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      mediaType: row.media_type,
      chars: text?.length ?? 0,
    };
    await emit(
      { type: "source", source: view },
      {
        type: "log",
        level: "info",
        text: `read ${row.name} · ${text === null ? "the model will look at it" : `${text.length.toLocaleString("en-US")} chars`}`,
      },
    );
  }
  // An addition builds on what is already committed; an Intake starts from the client alone.
  const base =
    input.trigger === "addition"
      ? await loadGraph(input.clientId)
      : emptyGraph(client.name);
  await emit(
    job("gather", "done", {
      ms: Date.now() - started,
      detail: plural(sources.length, "Source"),
    }),
    job("extract", "start", {
      detail: `${plural(sources.length, "Source")} in parallel`,
    }),
  );
  return { clientName: client.name, sources, base };
}
gatherStep.maxRetries = 1;

async function extractStep(
  input: BuildInput,
  clientName: string,
  source: GatheredSource,
  known: string,
): Promise<Extraction> {
  "use step";
  const started = Date.now();
  const { extraction, usage } = await extractSource({
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
      text: `${source.name}: ${plural(extraction.entities.length, "fact")}, ${plural(extraction.relations.length, "link")} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    },
  );
  return extraction;
}
extractStep.maxRetries = 2;

/** Joins every Source's facts in a fixed order, so a retry merges the same way. */
async function mergeStep(
  base: DraftGraph,
  sources: GatheredSource[],
  extractions: Extraction[],
  started: number,
): Promise<DraftGraph> {
  "use step";
  let graph = base;
  sources.forEach((source, index) => {
    const extraction = extractions[index];
    if (extraction) graph = mergeExtraction(graph, extraction, source.id).graph;
  });
  const stats = graphStats(graph);
  await emit(
    job("extract", "done", {
      ms: Date.now() - started,
      detail: `${plural(stats.nodes, "Node")}, ${plural(stats.edges, "Edge")}`,
    }),
    {
      type: "log",
      level: "info",
      text: "merged duplicate mentions across Sources",
    },
  );
  return graph;
}

/** Code's own checks, then the fixes code can make without asking. */
async function checkStep(
  input: BuildInput,
  graph: DraftGraph,
  sources: GatheredSource[],
  round: number,
): Promise<{ graph: DraftGraph; issues: Issue[]; applied: number }> {
  "use step";
  const started = Date.now();
  await emit(job("check", "start", { round }));
  const issues = validateGraph(graph, sources);
  await emit({ type: "issues", round, issues });
  const fixed = applyRepairs(graph, automaticRepairs(graph, issues), "check");
  await recordRepairs(input.buildId, round, fixed.applied);
  for (const repair of fixed.applied)
    await emit({ type: "repair", round, repair });
  const remaining = validateGraph(fixed.graph, sources);
  await emit(
    job("check", "done", {
      round,
      ms: Date.now() - started,
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
}

async function critiqueStep(
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
}> {
  "use step";
  const started = Date.now();
  await emit(job("critique", "start", { round }));
  const review = await critique({
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
      ms: Date.now() - started,
      detail:
        review.repairs.length === 0
          ? "looks right"
          : `${plural(review.repairs.length, "Repair")} proposed`,
    }),
  );
  if (review.notes)
    await emit({ type: "log", level: "info", text: `critic: ${review.notes}` });

  const repairStarted = Date.now();
  await emit(job("repair", "start", { round }));
  const fixed = applyRepairs(graph, review.repairs, "critic");
  await recordRepairs(input.buildId, round, fixed.applied);
  for (const repair of fixed.applied)
    await emit({ type: "repair", round, repair });
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
      ms: Date.now() - repairStarted,
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
}

/**
 * The last word: reconnect anything a Repair left floating, and drop facts no
 * Source supports that the Critic didn't vouch for.
 */
async function settleStep(
  input: BuildInput,
  graph: DraftGraph,
  sources: GatheredSource[],
  round: number,
): Promise<{ graph: DraftGraph; applied: number }> {
  "use step";
  const issues = validateGraph(graph, sources);
  const doubtful = issues
    .filter(
      (issue) => issue.kind === "unsupported" && !issue.target.includes("|"),
    )
    .flatMap((issue) => {
      const node = graph.nodes.find((item) => item.key === issue.target);
      return node && node.key !== ROOT_KEY && node.confidence < 0.5
        ? [node]
        : [];
    });
  let result = applyRepairs(
    graph,
    doubtful.map((node) => ({
      op: "remove_node" as const,
      key: node.key,
      reason: `Dropped ${node.label}: no Source says it and it was read with low confidence`,
    })),
    "check",
  );
  const applied: AppliedRepair[] = [...result.applied];
  const after = validateGraph(result.graph, sources);
  const second = applyRepairs(
    result.graph,
    automaticRepairs(result.graph, after),
    "check",
  );
  applied.push(...second.applied);
  result = second;
  await recordRepairs(input.buildId, round, applied);
  for (const repair of applied) await emit({ type: "repair", round, repair });
  return { graph: result.graph, applied: applied.length };
}

async function commitStep(input: BuildInput, graph: DraftGraph): Promise<void> {
  "use step";
  const started = Date.now();
  await emit(job("commit", "start"));
  await commitGraph(input.clientId, graph);
  const stats = graphStats(graph);
  await emit(
    job("commit", "done", {
      ms: Date.now() - started,
      detail: `${plural(stats.nodes, "Node")}, ${plural(stats.edges, "Edge")} in client_manager.nodes / edges`,
    }),
  );
}
commitStep.maxRetries = 2;

async function embedStep(input: BuildInput): Promise<void> {
  "use step";
  const started = Date.now();
  await emit(job("embed", "start"));
  const pending = await nodesWithoutEmbedding(input.clientId);
  const { embeddings, usage } = await embedTexts(
    contextOf(input),
    pending.map(nodeText),
  );
  await setEmbeddings(
    pending
      .map((node, index) => ({
        id: node.id,
        embedding: embeddings[index] ?? [],
      }))
      .filter((row) => row.embedding.length > 0),
  );
  if (usage) await emit({ type: "usage", usage });
  await emit(
    job("embed", "done", {
      ms: Date.now() - started,
      detail:
        pending.length === 0
          ? "already indexed"
          : `${plural(pending.length, "Node")} → vector(768), HNSW`,
    }),
  );
}
embedStep.maxRetries = 2;

async function personaStep(
  input: BuildInput,
  clientName: string,
  graph: DraftGraph,
): Promise<void> {
  "use step";
  const started = Date.now();
  await emit(job("persona", "start"));
  const context = contextOf(input);
  const { persona, usage } = await inferPersona({ context, clientName, graph });
  await setPersona(input.clientId, persona);
  await emit({ type: "usage", usage }, { type: "persona", persona });

  const client = await getClient(input.clientId);
  let detail = persona.archetype;
  if (client && !client.portrait_path) {
    try {
      const portrait = await paintPortrait({
        context,
        prompt: persona.portraitPrompt,
      });
      const path = `clients/${input.clientId}/portrait-${input.buildId}.jpg`;
      await upload(path, portrait.image, portrait.mediaType);
      await setPortrait(input.clientId, path, "generated");
      const url = await signedUrl(path);
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
  await emit(job("persona", "done", { ms: Date.now() - started, detail }));
}
personaStep.maxRetries = 1;

async function finishStep(
  input: BuildInput,
  graph: DraftGraph,
  rounds: number,
  repairs: number,
): Promise<void> {
  "use step";
  const build = await getBuild(input.buildId);
  const spend = await buildSpend(input.buildId);
  const stats = {
    ...graphStats(graph),
    repairs,
    rounds,
    costUsd: spend.cost,
    tokens: spend.tokens,
    ms: build ? Date.now() - build.created_at.getTime() : 0,
  };
  await updateBuild(input.buildId, { status: "completed", stats });
  await setClientStatus(input.clientId, "ready");
  const client = await getClient(input.clientId);
  await addMessage({
    clientId: input.clientId,
    sessionId: client?.session_id ?? "00000000-0000-0000-0000-000000000000",
    role: "assistant",
    mode: "build",
    content: `Graph ${input.trigger === "addition" ? "updated" : "ready"}: ${plural(stats.nodes, "Node")} and ${plural(stats.edges, "Edge")} across ${plural(stats.branches, "Branch")}, after ${plural(repairs, "Repair")} in ${plural(rounds, "review round")}.`,
    buildId: input.buildId,
    visitorHash: input.visitorHash,
  });
  await emit({ type: "end", status: "completed", stats });
  await getWritable().close();
}

async function failStep(input: BuildInput, message: string): Promise<void> {
  "use step";
  await updateBuild(input.buildId, { status: "failed", error: message });
  const build = await getBuild(input.buildId);
  if (build?.trigger === "intake")
    await setClientStatus(input.clientId, "failed");
  await emit(
    { type: "log", level: "error", text: message },
    { type: "end", status: "failed", error: message },
  );
  await getWritable().close();
}

// Workflow ------------------------------------------------------------------------

/**
 * Turns a Build's Sources into the Client graph: Gather, Extract each Source
 * in parallel, then up to two review rounds (Check, Critique, Repair) before
 * committing, embedding and inferring the Persona.
 */
export async function buildWorkflow(input: BuildInput) {
  "use workflow";
  try {
    const gathered = await gatherStep(input);
    const known =
      input.trigger === "addition"
        ? gathered.base.nodes
            .slice(0, 200)
            .map((node) => `${node.key} | ${node.label} | ${node.category}`)
            .join("\n")
        : "";
    const extractStarted = Date.now();
    const extractions = await Promise.all(
      gathered.sources.map((source) =>
        extractStep(input, gathered.clientName, source, known),
      ),
    );
    let graph = await mergeStep(
      gathered.base,
      gathered.sources,
      extractions,
      extractStarted,
    );

    let repairs = 0;
    let rounds = 0;
    const earlier: string[] = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      rounds = round;
      const checked = await checkStep(input, graph, gathered.sources, round);
      const reviewed = await critiqueStep(
        input,
        gathered.clientName,
        checked.graph,
        gathered.sources,
        checked.issues,
        round,
        earlier,
      );
      graph = reviewed.graph;
      repairs += checked.applied + reviewed.applied.length;
      earlier.push(...reviewed.applied);
      if (reviewed.verdict === "clean" || reviewed.applied.length === 0) break;
    }
    const settled = await settleStep(input, graph, gathered.sources, rounds);
    graph = settled.graph;
    repairs += settled.applied;

    await commitStep(input, graph);
    await embedStep(input);
    await personaStep(input, gathered.clientName, graph);
    await finishStep(input, graph, rounds, repairs);
  } catch (error) {
    await failStep(
      input,
      error instanceof Error ? error.message : String(error),
    );
  }
}
