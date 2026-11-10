import "server-only";
import { embedMany, generateImage, generateText, Output } from "ai";
import { z } from "zod";
import type { Persona, Usage } from "../domain/events";
import { type DraftGraph, describeGraph } from "../domain/graph";
import { EMBEDDING_DIMENSIONS, env } from "./env";
import { type CallContext, gateway, gatewayCost, track } from "./llm";

const personaSchema = z.object({
  archetype: z.string(),
  headline: z.string(),
  traits: z.array(z.string()),
  communication: z.string(),
  riskAppetite: z.enum(["low", "moderate", "high", "unknown"]),
  questions: z.array(z.string()),
  portraitPrompt: z.string(),
});

const INSTRUCTIONS = `You read a wealth manager's knowledge graph about one client and sum up who they are, so a relationship manager can glance at their card and know how to work with them.

- archetype: 2 or 3 words, a memorable type, such as "The Quiet Builder" or "Cautious Heir". Kind, never mocking.
- headline: one sentence, at most 18 words, on what matters most about them right now.
- traits: 3 to 5 single words or two-word phrases.
- communication: one sentence on how they like to be contacted and spoken to.
- riskAppetite: from what the graph says about risk, else "unknown".
- questions: 4 short questions a manager might ask about this client next, each answerable from the graph and each under 12 words.
- portraitPrompt: a description of an illustrated portrait of a fictional person who fits the client: apparent age, look, clothing and one or two objects or a backdrop that hint at their life (a sailboat, ledgers, a vineyard). Never a real or famous person, no text or logos. 40 to 70 words.

Use only the graph. If it is thin, keep everything short and say so in the headline.`;

export async function inferPersona(input: {
  context: CallContext;
  clientName: string;
  graph: DraftGraph;
}): Promise<{ persona: Persona; usage: Usage }> {
  const model = env.extractModel();
  const started = Date.now();
  const result = await generateText({
    model: gateway()(model),
    instructions: INSTRUCTIONS,
    output: Output.object({ schema: personaSchema }),
    reasoning: "low",
    messages: [
      {
        role: "user",
        content: `Client: ${input.clientName}\n\nGraph:\n${describeGraph(input.graph, 250)}`,
      },
    ],
  });
  const usage = await track(input.context, {
    purpose: "persona",
    model,
    usage: result.usage,
    costUsd: gatewayCost(result.providerMetadata),
    started,
  });
  const output = result.output;
  return {
    persona: {
      ...output,
      traits: output.traits.slice(0, 5),
      questions: output.questions.slice(0, 4),
    },
    usage,
  };
}

/** The house style every portrait shares, so the Catalog reads as one set. */
const STYLE =
  "Editorial illustrated portrait, head and shoulders, centred, looking at the viewer, warm ivory background (#f5f1e8), limited palette of navy (#1d4e89), ink, brass (#d9a84e) and soft skin tones, clean flat shapes with fine linework, subtle paper grain, calm and dignified, no text, no logos, no frame.";

export async function paintPortrait(input: {
  context: CallContext;
  prompt: string;
}): Promise<{ image: Uint8Array; mediaType: string; usage: Usage }> {
  const model = env.imageModel();
  const started = Date.now();
  const result = await generateImage({
    model: gateway().imageModel(model),
    prompt: `${input.prompt.trim()} ${STYLE}`,
    size: "768x768",
  });
  const image = result.images[0];
  if (!image) throw new Error("The image model returned no portrait");
  const meta = result.providerMetadata as Record<string, unknown> | undefined;
  const usage = await track(input.context, {
    purpose: "portrait",
    model,
    usage: undefined,
    costUsd: gatewayCost(meta) ?? 0.009,
    started,
  });
  return {
    image: image.uint8Array,
    mediaType: image.mediaType ?? "image/jpeg",
    usage,
  };
}

/** What a Node is embedded as: enough words for a question to find it. */
export function nodeText(node: {
  label: string;
  category: string;
  type: string;
  summary: string;
  attributes: Record<string, string>;
}) {
  const attributes = Object.entries(node.attributes ?? {})
    .map(([name, value]) => `${name.replace(/_/g, " ")}: ${value}`)
    .join("; ");
  return `${node.label} (${node.type}, ${node.category.replace(".", " › ")}). ${node.summary} ${attributes}`.trim();
}

export async function embedTexts(
  context: CallContext,
  values: string[],
): Promise<{ embeddings: number[][]; usage: Usage | null }> {
  if (values.length === 0) return { embeddings: [], usage: null };
  const model = env.embeddingModel();
  const started = Date.now();
  const result = await embedMany({
    model: gateway().embeddingModel(model),
    values,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const usage = await track(context, {
    purpose: "embed",
    model,
    usage: { inputTokens: result.usage?.tokens ?? 0, outputTokens: 0 },
    costUsd: gatewayCost(result.providerMetadata),
    started,
  });
  return { embeddings: result.embeddings, usage };
}
