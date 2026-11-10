import "server-only";
import { Output, streamText } from "ai";
import { z } from "zod";
import { describeCategories } from "../domain/categories";
import type { Usage } from "../domain/events";
import {
  type DraftEdge,
  type DraftNode,
  type Extraction,
  entityToNode,
  NODE_TYPES,
  relationToEdge,
} from "../domain/graph";
import { env } from "./env";
import type { GatheredSource } from "./gather";
import { type CallContext, gateway, gatewayCost, track } from "./llm";
import { download } from "./storage";

const entitySchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(NODE_TYPES),
  category: z.string(),
  summary: z.string(),
  attributes: z.array(z.object({ name: z.string(), value: z.string() })),
  quote: z.string(),
  confidence: z.number(),
});

const relationSchema = z.object({
  from: z.string(),
  to: z.string(),
  relation: z.string(),
  label: z.string(),
  quote: z.string(),
  confidence: z.number(),
});

const extractionSchema = z.object({
  entities: z.array(entitySchema),
  relations: z.array(relationSchema),
});

const INSTRUCTIONS = `You build a wealth manager's knowledge graph about one client from one Source: a note, a document, a spreadsheet or an image. The graph helps a relationship manager remember everything that matters about the client and the people and money around them.

Entities (Nodes):
- The client is always key "client". Never create another Node for the client; put facts about them on "client" (attributes) or in their own Nodes.
- One Node per distinct thing worth remembering: each person, organisation, account, holding, property, liability, insurance policy, goal, preference, personality trait, interest, value, life event, concern and shared document.
- key: "type:short-slug", stable and readable, such as "person:paolo-santos", "account:ubs-brokerage", "goal:retire-at-62". If the graph already has a Node for the same thing, reuse its key exactly.
- label: a short name (2 to 6 words) a person would scan.
- category: exactly one leaf from the Category tree below.
- summary: one plain sentence saying why it matters to the client.
- attributes: concrete facts as name/value pairs, such as amount, currency, date, institution, relationship, age, rate. Dates as YYYY-MM-DD when known. Copy amounts as written.
- quote: the exact words in the Source this Node stands on, at most 25 words, copied character for character. For an image, describe what you read in a few words instead.
- confidence: 0 to 1. Facts stated outright are 0.9 or more. Traits and preferences you infer from tone or behaviour are 0.4 to 0.7.

Relations (Edges):
- Every Node must be joined to at least one other Node; most join the client or a person near them.
- from and to are keys. relation is an UPPER_SNAKE verb that reads from → to: client MARRIED_TO person:paolo, person:lia STUDIES_AT organization:lse, client HOLDS account:ubs-brokerage, account:ubs-brokerage HOLDS asset:apple-shares, goal:fund-lia-tuition FUNDED_BY account:529-plan.
- label: the same relation in plain words, read from → to ("is married to").
- quote and confidence as for Nodes.

Rules:
- Only what the Source says or clearly implies. Never invent names, numbers or dates.
- Prefer many small, precise Nodes over a few vague ones, but do not split one fact into several Nodes.
- Personality matters: how the client talks, decides, what they fear and enjoy are Nodes under Personality.

Category tree (id (path): what belongs there):
${describeCategories()}`;

export type ExtractResult = {
  extraction: Extraction;
  usage: Usage;
};

function isComplete<T>(schema: z.ZodType<T>, value: unknown): value is T {
  return schema.safeParse(value).success;
}

/**
 * Reads one Source into Nodes and Edges, streaming: each Node and Edge is
 * reported as soon as the model has finished writing it.
 */
export async function extractSource(input: {
  context: CallContext;
  clientName: string;
  source: GatheredSource;
  /** The graph so far, for additions: Keys to reuse. */
  known: string;
  onNode: (node: DraftNode) => Promise<void>;
  onEdge: (edge: DraftEdge) => Promise<void>;
}): Promise<ExtractResult> {
  const { source } = input;
  const files =
    source.text === null && source.storagePath
      ? [
          {
            type: "file" as const,
            mediaType: source.mediaType,
            data: await download(source.storagePath),
          },
        ]
      : [];
  const header = `Client: ${input.clientName}\nSource: "${source.name}" (${source.kind})`;
  const known = input.known
    ? `\n\nAlready in the graph (reuse these keys for the same things):\n${input.known}`
    : "";
  const body =
    source.text === null
      ? "The Source is attached. Read it carefully, including any tables or handwriting."
      : `Source text:\n"""\n${source.text}\n"""`;

  const model = env.extractModel();
  const started = Date.now();
  const result = streamText({
    model: gateway()(model),
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: extractionSchema }),
    reasoning: "low",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${header}${known}\n\n${body}` },
          ...files,
        ],
      },
    ],
  });

  let nodesReported = 0;
  let edgesReported = 0;
  const report = async (partial: Partial<Extraction>, final: boolean) => {
    const entities = partial.entities ?? [];
    const relations = partial.relations ?? [];
    const entityLimit = final ? entities.length : entities.length - 1;
    for (; nodesReported < entityLimit; nodesReported++) {
      const entity = entities[nodesReported];
      if (!isComplete(entitySchema, entity)) {
        if (final) continue;
        break;
      }
      await input.onNode(entityToNode(entity, source.id));
    }
    const relationLimit = final ? relations.length : relations.length - 1;
    for (; edgesReported < relationLimit; edgesReported++) {
      const relation = relations[edgesReported];
      if (!isComplete(relationSchema, relation)) {
        if (final) continue;
        break;
      }
      await input.onEdge(relationToEdge(relation, source.id));
    }
  };

  for await (const partial of result.partialOutputStream) {
    await report(partial as Partial<Extraction>, false);
  }
  const output = await result.output;
  await report(output, true);
  const usage = await track(input.context, {
    purpose: "extract",
    model,
    usage: await result.usage,
    costUsd: gatewayCost(await result.providerMetadata),
    started,
  });
  return { extraction: output, usage };
}
