import "server-only";
import {
  createGateway,
  embedMany,
  type LanguageModelUsage,
  type streamText,
} from "ai";

type ProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]["providerOptions"]
>;

import type { AuditUsage } from "../domain/audit";
import { EMBEDDING_DIMENSIONS, env } from "./env";

let gatewayClient: ReturnType<typeof createGateway> | undefined;

/** The Vercel AI Gateway, with the Harness's key. */
export function gateway() {
  gatewayClient ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return gatewayClient;
}

/** The Agent in a Session (`HARNESS_MODEL`). */
export function chatModel() {
  return gateway()(env.chatModel());
}

/**
 * Provider options that make a model's thinking visible, so the chat can
 * stream it. Current Claude models think (adaptive, at their default effort)
 * but return empty thinking blocks unless asked for a summary; OpenAI and
 * Google send none unless asked. Visibility only: what the model thinks, and
 * what it costs, is the same either way.
 */
export function visibleThinking(model: string): ProviderOptions | undefined {
  if (model.startsWith("anthropic/")) {
    return {
      anthropic: { thinking: { type: "adaptive", display: "summarized" } },
    };
  }
  if (model.startsWith("openai/")) {
    return { openai: { reasoningSummary: "auto" } };
  }
  if (model.startsWith("google/")) {
    return { google: { thinkingConfig: { includeThoughts: true } } };
  }
  return undefined;
}

/** Steps that read or draft, and the Conflict check (`HARNESS_STEP_MODEL`). */
export function stepModel() {
  return gateway()(env.stepModel());
}

/**
 * List prices per million tokens (USD), used only when the gateway does not
 * report what it charged. The same figures as Casework's `MODELS`.
 */
const LIST_PRICE: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10 },
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
  "openai/gpt-6.1-terra": { input: 1, output: 5 },
  "openai/gpt-6-luna": { input: 0.1, output: 0.5 },
  "openai/text-embedding-3-small": { input: 0.02, output: 0 },
};

/** USD for a call from its tokens, or null for a model with no list price here. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = LIST_PRICE[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The price the gateway charged, from `providerMetadata.gateway.cost`, or null. */
export function gatewayCost(providerMetadata: unknown): number | null {
  const gatewayMeta = isRecord(providerMetadata)
    ? providerMetadata.gateway
    : undefined;
  if (!isRecord(gatewayMeta)) return null;
  for (const value of [gatewayMeta.cost, gatewayMeta.marketCost]) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number)) return number;
  }
  return null;
}

/**
 * What one model call cost, in the shape messages, Run Steps and Audit
 * events all store: the gateway's own figure when it reports one, else an
 * estimate from the list price, else null.
 */
export function usageOf(input: {
  model: string;
  usage: Partial<LanguageModelUsage> | undefined;
  providerMetadata?: unknown;
}): AuditUsage {
  const inputTokens = input.usage?.inputTokens ?? 0;
  const outputTokens = input.usage?.outputTokens ?? 0;
  return {
    model: input.model,
    inputTokens,
    outputTokens,
    costUsd:
      gatewayCost(input.providerMetadata) ??
      estimateCost(input.model, inputTokens, outputTokens),
  };
}

/** Adds up the calls of one turn or one Step. The model named is the first call's. */
export function addUsage(calls: AuditUsage[]): AuditUsage | null {
  const [first] = calls;
  if (!first) return null;
  return calls.slice(1).reduce<AuditUsage>(
    (sum, call) => ({
      model: sum.model,
      inputTokens: sum.inputTokens + call.inputTokens,
      outputTokens: sum.outputTokens + call.outputTokens,
      costUsd:
        sum.costUsd === null && call.costUsd === null
          ? null
          : (sum.costUsd ?? 0) + (call.costUsd ?? 0),
    }),
    first,
  );
}

/**
 * Embeds texts for the Knowledge base at 768 dimensions (ADR 0016), in the
 * order given. The caller records the usage (on an Audit event).
 */
export async function embed(
  texts: string[],
): Promise<{ embeddings: number[][]; usage: AuditUsage | null }> {
  if (texts.length === 0) return { embeddings: [], usage: null };
  const model = env.embeddingModel();
  const result = await embedMany({
    model: gateway().embeddingModel(model),
    values: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return {
    embeddings: result.embeddings,
    usage: usageOf({
      model,
      usage: { inputTokens: result.usage?.tokens ?? 0, outputTokens: 0 },
      providerMetadata: result.providerMetadata,
    }),
  };
}

/** An embedding as the text pgvector reads: `[0.1,0.2,…]`. Cast it with `::extensions.vector`. */
export function toVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
