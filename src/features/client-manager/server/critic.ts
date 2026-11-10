import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { describeCategories } from "../domain/categories";
import type { Usage } from "../domain/events";
import {
  type DraftGraph,
  describeGraph,
  type Issue,
  type Repair,
} from "../domain/graph";
import { env } from "./env";
import type { GatheredSource } from "./gather";
import { type CallContext, gateway, gatewayCost, track } from "./llm";

const OPS = [
  "remove_node",
  "merge_nodes",
  "move_node",
  "update_node",
  "resolve_conflict",
  "add_edge",
  "remove_edge",
] as const;

// Flat and fully required, so every provider's strict structured output accepts it.
const critiqueSchema = z.object({
  verdict: z.enum(["clean", "needs_changes"]),
  notes: z.string(),
  repairs: z.array(
    z.object({
      op: z.enum(OPS),
      key: z.string().nullable(),
      keep: z.string().nullable(),
      drop: z.string().nullable(),
      category: z.string().nullable(),
      label: z.string().nullable(),
      summary: z.string().nullable(),
      attribute: z.string().nullable(),
      value: z.string().nullable(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      relation: z.string().nullable(),
      reason: z.string(),
    }),
  ),
});

type RawRepair = z.infer<typeof critiqueSchema>["repairs"][number];

const INSTRUCTIONS = `You are the Critic. Another model read a wealth manager's notes and files about one client and drafted a knowledge graph. Your job is to find its mistakes and fix them with Repairs, so the graph a relationship manager relies on is correct, tidy and well connected.

Look for:
- Unsupported Nodes or Edges: nothing in the Sources says it. Remove them. Facts read from images or scanned files cannot be checked against text; keep them unless they contradict the text.
- Duplicates: two Nodes for the same real thing (the same person by nickname and full name, the same account twice). Merge them, keeping the better Key. Never merge different kinds of thing: a bank and an account held there are two Nodes joined by an Edge.
- Wrong Category: move the Node to the right leaf.
- Conflicts: an attribute with two values. Resolve it with the value the Sources support best (usually the most recent or most specific).
- Wrong or missing links: an Edge pointing the wrong way, a vague RELATED_TO where a precise verb is clear, or two Nodes the Sources clearly connect but the graph doesn't (a child and the trust that names them, a goal and the account that funds it). Remove and add Edges.
- Unclear labels or summaries a manager would misread: update them.
- Stale facts: life moves on. When a new Source supersedes something already in the graph (a will now signed, a loan repaid, a new job), update or remove the old Node instead of keeping both. On an addition, the Sources you see are the new ones; Nodes they don't mention came from earlier Sources and stand unless the new Sources contradict them.

Rules:
- Use only Keys that appear in the graph. Never touch the Node "client" except to add Edges to it or update its summary.
- Each Repair names its op and fills only the fields that op uses; every other field is null:
  remove_node: key · merge_nodes: keep, drop · move_node: key, category · update_node: key, label and/or summary · resolve_conflict: key, attribute, value · add_edge: from, to, relation (UPPER_SNAKE), label (plain words) · remove_edge: from, to, relation.
- reason: one short sentence a manager would understand.
- Every Edge you add must be stated or clearly implied by the Sources; the reason says where. Never add an Edge as a guess or a placeholder.
- In a later round you see the Repairs already made. Do not undo or redo them; only fix what is still wrong.
- Be precise, not busy: if the graph is right, return verdict "clean" and no Repairs. At most 25 Repairs.

Category tree:
${describeCategories()}`;

function toRepair(raw: RawRepair): Repair | null {
  const reason = raw.reason || "Critic";
  switch (raw.op) {
    case "remove_node":
      return raw.key ? { op: raw.op, key: raw.key, reason } : null;
    case "merge_nodes":
      return raw.keep && raw.drop
        ? { op: raw.op, keep: raw.keep, drop: raw.drop, reason }
        : null;
    case "move_node":
      return raw.key && raw.category
        ? { op: raw.op, key: raw.key, category: raw.category, reason }
        : null;
    case "update_node":
      return raw.key
        ? {
            op: raw.op,
            key: raw.key,
            label: raw.label ?? undefined,
            summary: raw.summary ?? undefined,
            reason,
          }
        : null;
    case "resolve_conflict":
      return raw.key && raw.attribute && raw.value
        ? {
            op: raw.op,
            key: raw.key,
            attribute: raw.attribute,
            value: raw.value,
            reason,
          }
        : null;
    case "add_edge":
      return raw.from && raw.to && raw.relation
        ? {
            op: raw.op,
            from: raw.from,
            to: raw.to,
            relation: raw.relation,
            label: raw.label ?? raw.relation.toLowerCase().replace(/_/g, " "),
            reason,
          }
        : null;
    case "remove_edge":
      return raw.from && raw.to
        ? {
            op: raw.op,
            from: raw.from,
            to: raw.to,
            relation: raw.relation ?? "",
            reason,
          }
        : null;
  }
}

function describeSources(sources: GatheredSource[], budget = 60_000) {
  let left = budget;
  return sources
    .map((source) => {
      const text =
        source.text === null
          ? "(an image or scanned file: read by the extractor, not available as text)"
          : source.text.slice(0, Math.max(0, left));
      left -= text.length;
      return `### Source ${source.id} · "${source.name}" (${source.kind})\n${text}`;
    })
    .join("\n\n");
}

export type Critique = {
  verdict: "clean" | "needs_changes";
  notes: string;
  repairs: Repair[];
  usage: Usage;
};

export async function critique(input: {
  context: CallContext;
  clientName: string;
  graph: DraftGraph;
  sources: GatheredSource[];
  issues: Issue[];
  round: number;
  /** What earlier rounds already changed, so this one doesn't undo it. */
  earlier: string[];
}): Promise<Critique> {
  const model = env.criticModel();
  const started = Date.now();
  const issues = input.issues.length
    ? input.issues
        .map((issue) => `- ${issue.kind} · ${issue.target}: ${issue.detail}`)
        .join("\n")
    : "- none";
  const result = await generateText({
    model: gateway()(model),
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: critiqueSchema }),
    reasoning: "low",
    messages: [
      {
        role: "user",
        content: `Client: ${input.clientName}\nReview round ${input.round}.\n\nSources:\n${describeSources(input.sources)}\n\nDraft graph (N key | label | category | summary | attributes, E from -RELATION-> to):\n${describeGraph(input.graph)}\n\nIssues code already found:\n${issues}${input.earlier.length > 0 ? `\n\nRepairs made in earlier rounds:\n${input.earlier.map((item) => `- ${item}`).join("\n")}` : ""}`,
      },
    ],
  });
  const usage = await track(input.context, {
    purpose: "critique",
    model,
    usage: result.usage,
    costUsd: gatewayCost(result.providerMetadata),
    started,
  });
  const output = result.output;
  return {
    verdict: output.verdict,
    notes: output.notes,
    repairs: output.repairs.slice(0, 25).flatMap((raw) => toRepair(raw) ?? []),
    usage,
  };
}
