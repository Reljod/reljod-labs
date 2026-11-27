import "server-only";
import { type LanguageModel, type Tool, tool } from "ai";
import { z } from "zod";
import type { Persona, Usage } from "../domain/events";
import {
  type Extraction,
  entityToNode,
  ROOT_KEY,
  relationToEdge,
  slugify,
} from "../domain/graph";
import type { DeskModel } from "./assistant";
import type {
  Critic,
  Embedder,
  Extractor,
  Painter,
  PersonaWriter,
} from "./ports";

/*
 * The canned models of the stubbed e2e suite (`stub` in the containers).
 * They call nothing and cost nothing; everything around them stays real:
 * the gates, the caps, the workflow, the MCP server, Storage and the
 * database. A Build of the Elena Marsh example reads into the graph a
 * careful extractor would draw; any other text becomes one fact per
 * sentence, so the Check still finds every quote in its Source.
 */

const STUB = "stub/canned";

const free = (purpose: Usage["purpose"]): Usage => ({
  purpose,
  model: STUB,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  ms: 0,
});

type Entity = Extraction["entities"][number];
type Relation = Extraction["relations"][number];

/** A fact the canned extractor draws when its quote is in the Source. */
type Canned = {
  quote: string;
  entity?: Omit<Entity, "quote" | "confidence"> & { confidence?: number };
  /** To the client unless `from` says otherwise. */
  link?: { relation: string; label: string; from?: string; to?: string };
};

/** The Elena Marsh example (`domain/examples.ts`): quotes copied from its note. */
const ELENA: Canned[] = [
  {
    quote: "her husband Daniel passed in March 2026",
    entity: {
      key: "person:daniel-marsh",
      label: "Daniel Marsh",
      type: "person",
      category: "network.family",
      summary: "Elena's late husband; his estate is still being settled.",
      attributes: [{ name: "died", value: "2026-03" }],
    },
    link: { relation: "WIDOW_OF", label: "is the widow of" },
  },
  {
    quote: "their lawyer, Priya Nair at Nair & Cole",
    entity: {
      key: "person:priya-nair",
      label: "Priya Nair",
      type: "person",
      category: "network.advisors",
      summary: "The family lawyer settling Daniel's estate.",
      attributes: [{ name: "firm", value: "Nair & Cole" }],
    },
    link: { relation: "ADVISED_BY", label: "is advised by" },
  },
  {
    quote: "still settling his estate",
    entity: {
      key: "event:daniel-estate",
      label: "Daniel's estate",
      type: "event",
      category: "goals.estate",
      summary: "Daniel's estate is still being settled with Priya Nair.",
      attributes: [],
    },
    link: { relation: "SETTLING", label: "is settling" },
  },
  {
    quote: "Tom (34) is a surgeon in Westmere.",
    entity: {
      key: "person:tom-marsh",
      label: "Tom Marsh",
      type: "person",
      category: "network.family",
      summary: "Elena's son, a surgeon in Westmere.",
      attributes: [
        { name: "age", value: "34" },
        { name: "occupation", value: "surgeon" },
      ],
    },
    link: { relation: "PARENT_OF", label: "is the mother of" },
  },
  {
    quote: "Ivy (29) runs a pottery studio",
    entity: {
      key: "person:ivy-marsh",
      label: "Ivy Marsh",
      type: "person",
      category: "network.family",
      summary: "Elena's daughter, who runs a pottery studio.",
      attributes: [{ name: "age", value: "29" }],
    },
    link: { relation: "PARENT_OF", label: "is the mother of" },
  },
  {
    quote: "expecting her first child in January",
    entity: {
      key: "event:ivy-first-child",
      label: "Ivy's first child due",
      type: "event",
      category: "timeline.upcoming",
      summary: "Ivy expects her first child in January.",
      attributes: [{ name: "due", value: "January" }],
    },
    link: {
      relation: "EXPECTING",
      label: "is expecting",
      from: "person:ivy-marsh",
    },
  },
  {
    quote: "Marsh Dynamics, in 2025 for about M$18M",
    entity: {
      key: "organization:marsh-dynamics",
      label: "Marsh Dynamics",
      type: "organization",
      category: "career.business",
      summary: "Daniel's marine-engineering firm, sold by Elena in 2025.",
      attributes: [
        { name: "sold", value: "2025" },
        { name: "price", value: "M$18M" },
      ],
    },
    link: { relation: "SOLD", label: "sold" },
  },
  {
    quote: "cash at Calder Private Bank (around M$9M)",
    entity: {
      key: "account:calder-private-bank",
      label: "Calder Private Bank cash",
      type: "account",
      category: "wealth.accounts",
      summary: "Most of the sale proceeds, held in cash.",
      attributes: [{ name: "balance", value: "M$9M" }],
    },
    link: { relation: "HOLDS", label: "holds" },
  },
  {
    quote: "a M$4M discretionary portfolio with us",
    entity: {
      key: "account:discretionary-portfolio",
      label: "Discretionary portfolio",
      type: "account",
      category: "wealth.accounts",
      summary: "The portfolio we manage for her.",
      attributes: [{ name: "value", value: "M$4M" }],
    },
    link: { relation: "HOLDS", label: "holds" },
  },
  {
    quote: "the family home in Henlow outright",
    entity: {
      key: "asset:henlow-home",
      label: "Henlow family home",
      type: "asset",
      category: "wealth.property",
      summary: "The family home, owned outright.",
      attributes: [{ name: "mortgage", value: "none" }],
    },
    link: { relation: "OWNS", label: "owns" },
  },
  {
    quote: "a cottage on the Saltmere coast she wants to give to Ivy",
    entity: {
      key: "asset:saltmere-cottage",
      label: "Saltmere cottage",
      type: "asset",
      category: "wealth.property",
      summary: "A coastal cottage Elena wants to give to Ivy.",
      attributes: [],
    },
    link: { relation: "OWNS", label: "owns" },
  },
  {
    quote: "she wants to give to Ivy",
    link: {
      relation: "INTENDED_FOR",
      label: "is meant for",
      from: "asset:saltmere-cottage",
      to: "person:ivy-marsh",
    },
  },
  {
    quote: "cannot lose what Daniel built",
    entity: {
      key: "trait:cautious",
      label: "Very cautious",
      type: "trait",
      category: "persona.traits",
      summary: "Cautious since the sale; afraid of losing what Daniel built.",
      attributes: [],
    },
    link: { relation: "HAS_TRAIT", label: "is" },
  },
  {
    quote: "Prefers a phone call in the morning",
    entity: {
      key: "preference:morning-calls",
      label: "Morning phone calls",
      type: "preference",
      category: "persona.communication",
      summary: "Prefers a call in the morning and everything on one page.",
      attributes: [],
    },
    link: { relation: "PREFERS", label: "prefers" },
  },
  {
    quote: "Loves sailing and gardening.",
    entity: {
      key: "interest:sailing",
      label: "Sailing and gardening",
      type: "interest",
      category: "persona.interests",
      summary: "What she loves doing.",
      attributes: [],
    },
    link: { relation: "ENJOYS", label: "enjoys" },
  },
  {
    quote: "Sits on the board of Tidewatch Trust",
    entity: {
      key: "organization:tidewatch-trust",
      label: "Tidewatch Trust",
      type: "organization",
      category: "goals.philanthropy",
      summary: "A coastal conservation charity whose board she sits on.",
      attributes: [{ name: "role", value: "board member" }],
    },
    link: { relation: "BOARD_MEMBER_OF", label: "sits on the board of" },
  },
  {
    quote: "Worried about inheritance tax",
    entity: {
      key: "concern:inheritance-tax",
      label: "Inheritance tax",
      type: "concern",
      category: "risk.concerns",
      summary: "Worried about inheritance tax on the estate.",
      attributes: [],
    },
    link: { relation: "WORRIED_ABOUT", label: "is worried about" },
  },
];

/** The canned facts whose quotes are in the text, and their links. */
function cannedExtraction(text: string, canned: Canned[]): Extraction {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (const item of canned) {
    if (!text.includes(item.quote)) continue;
    if (item.entity)
      entities.push({
        ...item.entity,
        quote: item.quote,
        confidence: item.entity.confidence ?? 0.92,
      });
    const to = item.link?.to ?? item.entity?.key;
    if (item.link && to)
      relations.push({
        from: item.link.from ?? ROOT_KEY,
        to,
        relation: item.link.relation,
        label: item.link.label,
        quote: item.quote,
        confidence: 0.9,
      });
  }
  return { entities, relations };
}

/** Any other text: one fact per sentence, each linked to the client by its own words. */
function sentenceExtraction(text: string): Extraction {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 4)
    .slice(0, 12);
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  sentences.forEach((sentence, index) => {
    const words = sentence.split(/\s+/);
    const quote = words.slice(0, 25).join(" ");
    const key = `fact:${slugify(words.slice(0, 5).join(" ")) || `note-${index + 1}`}`;
    entities.push({
      key,
      label: words
        .slice(0, 6)
        .join(" ")
        .replace(/[.,;:!?]+$/, ""),
      type: "fact",
      category: "timeline.past",
      summary: sentence.slice(0, 300),
      attributes: [],
      quote,
      confidence: 0.9,
    });
    relations.push({
      from: ROOT_KEY,
      to: key,
      relation: "NOTED",
      label: "is noted for",
      quote,
      confidence: 0.9,
    });
  });
  return { entities, relations };
}

/** Reads a Source without a model: canned for the examples, one fact per sentence otherwise. */
export const cannedExtractor: Extractor = {
  async extract({ source, onNode, onEdge }) {
    const text = source.text ?? "";
    const canned = cannedExtraction(text, ELENA);
    const extraction =
      canned.entities.length >= 3 ? canned : sentenceExtraction(text);
    for (const entity of extraction.entities)
      await onNode(entityToNode(entity, source.id));
    for (const relation of extraction.relations)
      await onEdge(relationToEdge(relation, source.id));
    return { extraction, usage: free("extract") };
  },
};

/** A Critic that finds the Draft graph right: the Check's own fixes still run. */
export const cleanCritic: Critic = {
  async critique() {
    return {
      verdict: "clean",
      notes: "",
      repairs: [],
      usage: free("critique"),
    };
  },
};

/** A Persona from what the graph holds, in words a test can rely on. */
export const cannedPersona: PersonaWriter = {
  async infer({ clientName, graph }) {
    const of = (prefix: string) =>
      graph.nodes.filter((node) => node.category.startsWith(prefix));
    const traits = of("persona.traits").map((node) => node.label);
    const communication = of("persona.communication")[0]?.summary;
    const facts = graph.nodes.length - 1;
    const persona: Persona = {
      archetype: "The Steady Hand",
      headline: `${clientName}: ${facts} fact${facts === 1 ? "" : "s"} on file so far.`,
      traits: (traits.length > 0 ? traits : ["Considered"]).slice(0, 5),
      communication:
        communication ?? "Not known yet; ask how they like to be reached.",
      riskAppetite: of("risk.").length > 0 ? "low" : "unknown",
      questions: [
        "What matters most to them this year?",
        "Who else should we know about?",
        "How are their accounts held?",
        "What worries them most?",
      ],
      portraitPrompt: `An illustrated portrait of a fictional person called ${clientName}.`,
    };
    return { persona, usage: free("persona") };
  },
};

/** A one-pixel PNG, so the Portrait's upload and signing still run. */
const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

export const pixelPainter: Painter = {
  async paint() {
    return { image: PIXEL, mediaType: "image/png", usage: free("portrait") };
  },
};

/** No vectors: the Embed job leaves Nodes to full-text search, and a search uses words alone. */
export const noEmbedder: Embedder = {
  async embed(_context, values) {
    return { embeddings: values.map(() => []), usage: null };
  },
};

// The Desk ---------------------------------------------------------------------------

type ScriptedModel = Extract<LanguageModel, { specificationVersion: "v4" }>;
type StreamOptions = Parameters<ScriptedModel["doStream"]>[0];
type StreamPart =
  Awaited<
    ReturnType<ScriptedModel["doStream"]>
  >["stream"] extends ReadableStream<infer P>
    ? P
    : never;

const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function textOf(message: StreamOptions["prompt"][number] | undefined) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function streamOf(parts: StreamPart[]): ReadableStream<StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function said(text: string): StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    {
      type: "finish",
      usage: NO_USAGE,
      finishReason: { unified: "stop", raw: "stop" },
    },
  ];
}

const CITATION = /\[\[[0-9a-f]{8}\/[a-z0-9_-]+(?::[a-z0-9_-]+)?\]\]/g;

/**
 * The Desk's model for the stubbed e2e suite: a script, not a model. It
 * searches the graphs for the question through the real MCP server, then
 * answers with the facts the search found, cited as the tools print them.
 */
const scriptedDesk: ScriptedModel = {
  specificationVersion: "v4",
  provider: "client-manager-stub",
  modelId: "scripted-desk",
  supportedUrls: {},
  async doGenerate() {
    throw new Error("The scripted Desk only streams.");
  },
  async doStream(options) {
    const last = options.prompt.at(-1);
    if (last?.role === "tool") {
      const refs = [
        ...new Set(JSON.stringify(last.content).match(CITATION) ?? []),
      ].slice(0, 3);
      return {
        stream: streamOf(
          said(
            refs.length > 0
              ? `Here is what the graph holds on that: ${refs.join(", ")}.`
              : "The graph doesn't say. Ask the client.",
          ),
        ),
      };
    }
    const tools = new Set((options.tools ?? []).map((item) => item.name));
    if (!tools.has("search"))
      return { stream: streamOf(said("The graph isn't reachable now.")) };
    return {
      stream: streamOf([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "search",
          input: JSON.stringify({ query: textOf(last).slice(0, 200) }),
        },
        {
          type: "finish",
          usage: NO_USAGE,
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
        },
      ]),
    };
  },
};

/** A web search that finds nothing, so Research runs without the paid search. */
const noWebSearch = (): Tool =>
  tool({
    description: "Searches the web.",
    inputSchema: z.object({ query: z.string() }),
    execute: async () => ({ results: [] }),
  });

export const scriptedDeskModel: DeskModel = {
  model: () => ({ model: scriptedDesk, id: `stub/${scriptedDesk.modelId}` }),
  webSearch: noWebSearch,
};
