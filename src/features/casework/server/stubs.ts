import "server-only";
import type { LanguageModel } from "ai";
import {
  DOCUMENT_KIND_IDS,
  DOCUMENT_KINDS,
  type DocumentKind,
} from "../domain/document-kinds";
import type { Purpose } from "../domain/model-config";
import { decide } from "../domain/rules/decision";
import { adjudicate } from "../domain/rules/screening";
import type { FieldValue } from "../domain/run-state";
import type { CallCost } from "./llm";
import type { Reader, SpecialistModel } from "./ports";
import type { DocumentLabel } from "./repository";

/*
 * The canned models of the stubbed e2e suite (`stub` in the containers).
 * They call nothing and cost nothing; everything around them stays real: the
 * gates, the caps, the MCP server, the workflow and the database.
 */

const STUB_MODEL = "stub/labelled";

const free = (purpose: Purpose): CallCost => ({
  purpose,
  model: STUB_MODEL,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  ms: 0,
});

/**
 * Reads a Document by its label: a seeded Cabinet Document's labelled Kind
 * and fields are what a correct Sort and Read return. An upload has no label
 * and sorts as "other". The Rules propose the Hits and write the Decision
 * file, as they do before the model words them.
 */
export function labelledReader(
  labels: (ids: string[]) => Promise<Map<string, DocumentLabel>>,
): Reader {
  return {
    async sort(_ctx, document) {
      const label = (await labels([document.id])).get(document.id);
      const kind = DOCUMENT_KIND_IDS.find((id) => id === label?.label_kind);
      return {
        kind: kind ?? null,
        gist: kind ? DOCUMENT_KINDS[kind].label : document.name,
        cost: free("sort"),
      };
    },

    async read(_ctx, document, kind: DocumentKind, onField) {
      const label = (await labels([document.id])).get(document.id)?.label ?? {};
      const fields: Record<string, FieldValue> = {};
      for (const name of Object.keys(DOCUMENT_KINDS[kind].fields)) {
        if (!(name in label)) continue;
        fields[name] = label[name] as FieldValue;
        await onField(name, fields[name]);
      }
      return {
        fields,
        evidence: {},
        parser: document.sourceFormat === "csv" ? "csv" : "vision",
        spanCount: 0,
        cost: free("read"),
      };
    },

    async adjudicate(_ctx, state, watchlist) {
      return {
        hits: adjudicate(state, watchlist).patch?.hits ?? [],
        cost: null,
      };
    },

    async decide(_ctx, state) {
      return { decision: decide(state).decision, cost: null };
    },
  };
}

type ScriptedModel = Extract<LanguageModel, { specificationVersion: "v4" }>;
type StreamOptions = Parameters<ScriptedModel["doStream"]>[0];
type StreamPart =
  Awaited<
    ReturnType<ScriptedModel["doStream"]>
  >["stream"] extends ReadableStream<infer P>
    ? P
    : never;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const NO_USAGE = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function textOf(message: StreamOptions["prompt"][number] | undefined) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * The tool the scripted Specialist calls for a message: the pipeline or job
 * the message names (`pipeline_withdrawal`, `job_sort`), else
 * `review_documents`, with the ids of the Documents attached to it.
 */
function plannedCall(options: StreamOptions) {
  const last = textOf(options.prompt.at(-1));
  const attachedBlock =
    last.split("Attached to this message:")[1]?.split("\n\n")[0] ?? "";
  const documentIds = [...new Set(attachedBlock.match(UUID) ?? [])];
  if (documentIds.length === 0) return null;
  const message = last.split("Message:").at(-1) ?? "";
  const tools = new Set((options.tools ?? []).map((tool) => tool.name));
  const named = message.match(/\b(pipeline|job)_[a-z_]+\b/)?.[0];
  const toolName = named && tools.has(named) ? named : "review_documents";
  return { toolName, input: JSON.stringify({ documentIds }) };
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

/**
 * The Specialist's model for the stubbed e2e suite: a script, not a model.
 * With Documents attached it calls the tool the message names (or
 * `review_documents`) with their ids, through the real MCP server, and once
 * the tool has answered says so in one line. Without Documents it asks for
 * them.
 */
const scriptedSpecialist: ScriptedModel = {
  specificationVersion: "v4",
  provider: "casework-stub",
  modelId: "scripted-specialist",
  supportedUrls: {},
  async doGenerate() {
    throw new Error("The scripted Specialist only streams.");
  },
  async doStream(options) {
    if (options.prompt.at(-1)?.role === "tool")
      return {
        stream: streamOf(said("Started it. The Run streams onto the desk.")),
      };
    const call = plannedCall(options);
    if (!call)
      return {
        stream: streamOf(
          said(
            "Drop a Case file's documents on the desk and I'll review them.",
          ),
        ),
      };
    return {
      stream: streamOf([
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: call.toolName,
          input: call.input,
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

export const scriptedSpecialistModel: SpecialistModel = () => ({
  model: scriptedSpecialist,
});
