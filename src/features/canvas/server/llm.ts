import "server-only";
import { createGateway, type LanguageModelUsage, type streamText } from "ai";
import type { TrailUsage } from "../domain/trail";
import { env } from "./env";

type ProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]["providerOptions"]
>;

let gatewayClient: ReturnType<typeof createGateway> | undefined;

/** The Vercel AI Gateway, with Canvas's key. */
export function gateway() {
  gatewayClient ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return gatewayClient;
}

/** The Analyst (`CANVAS_MODEL`). */
export function analystModel() {
  return gateway()(env.model());
}

/** Provider options that make a model's thinking visible, so the chat can stream it. */
export function visibleThinking(model: string): ProviderOptions | undefined {
  if (model.startsWith("anthropic/"))
    return {
      anthropic: { thinking: { type: "adaptive", display: "summarized" } },
    };
  if (model.startsWith("openai/"))
    return { openai: { reasoningSummary: "auto" } };
  if (model.startsWith("google/"))
    return { google: { thinkingConfig: { includeThoughts: true } } };
  return undefined;
}

/**
 * List prices per million tokens (USD), used only when the gateway does not
 * report what it charged. The same figures as the Harness's.
 */
const LIST_PRICE: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 2, output: 10 },
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
  "openai/gpt-6.1-terra": { input: 1, output: 5 },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The price the gateway charged, from `providerMetadata.gateway.cost`, or null. */
function gatewayCost(providerMetadata: unknown): number | null {
  const meta = isRecord(providerMetadata)
    ? providerMetadata.gateway
    : undefined;
  if (!isRecord(meta)) return null;
  for (const value of [meta.cost, meta.marketCost]) {
    const number = typeof value === "string" ? Number(value) : value;
    // Zero means "not priced", not "free": fall back to the list price.
    if (typeof number === "number" && Number.isFinite(number) && number > 0)
      return number;
  }
  return null;
}

/**
 * What one model call cost: the gateway's own figure when it reports one,
 * else an estimate from the list price. An unknown model with no reported
 * cost counts at the dearest list price, so the USD cap still holds.
 */
export function usageOf(input: {
  model: string;
  usage: Partial<LanguageModelUsage> | undefined;
  providerMetadata?: unknown;
}): TrailUsage {
  const inputTokens = input.usage?.inputTokens ?? 0;
  const outputTokens = input.usage?.outputTokens ?? 0;
  const price = LIST_PRICE[input.model] ?? { input: 2, output: 10 };
  return {
    model: input.model,
    inputTokens,
    outputTokens,
    costUsd:
      gatewayCost(input.providerMetadata) ??
      (inputTokens * price.input + outputTokens * price.output) / 1_000_000,
  };
}
