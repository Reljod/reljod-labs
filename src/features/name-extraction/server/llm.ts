import "server-only";
import { createGateway, type LanguageModelUsage } from "ai";
import {
  estimateCost,
  type Purpose,
  type RunEventInput,
} from "../domain/contract";
import { recordCall } from "./emit";
import { env } from "./env";

let gatewayClient: ReturnType<typeof createGateway> | undefined;

export function gateway() {
  gatewayClient ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return gatewayClient;
}

/**
 * Providers to route a model to first. GPT-6.1 Terra on Azure and Bedrock was
 * flaky on 2026-11-17 (docs/research/name-extraction.md), so it goes to
 * OpenAI direct.
 */
const PROVIDER_ORDER: Record<string, string[]> = {
  "openai/gpt-6.1-terra": ["openai"],
};

/**
 * The AI SDK options for one call. Every call asks the gateway to cache
 * (Anthropic does not cache without it); Readers run with reasoning off,
 * the Analyst with a little.
 */
export function callOptions(model: string, purpose: Purpose) {
  const order = PROVIDER_ORDER[model];
  return {
    model: gateway()(model),
    reasoning: purpose === "reader" ? ("none" as const) : ("low" as const),
    providerOptions: {
      gateway: { caching: "auto" as const, ...(order ? { order } : {}) },
    },
  };
}

export type CallCost = Extract<RunEventInput, { type: "cost" }>;

/**
 * What a call is worth according to the gateway: the larger of what it
 * charged (`cost`) and the list price (`marketCost`), or null when it reports
 * neither. A call paid by credits reports `cost` 0; the demo shows and caps
 * spend at what the call is worth, so it takes the market price.
 */
export function gatewayCost(providerMetadata: unknown): number | null {
  const meta =
    typeof providerMetadata === "object" && providerMetadata !== null
      ? (providerMetadata as { gateway?: unknown }).gateway
      : undefined;
  if (typeof meta !== "object" || meta === null) return null;
  const { cost, marketCost } = meta as { cost?: unknown; marketCost?: unknown };
  let best: number | null = null;
  for (const value of [cost, marketCost]) {
    const number = typeof value === "string" ? Number(value) : value;
    if (typeof number === "number" && Number.isFinite(number) && number >= 0)
      best = Math.max(best ?? 0, number);
  }
  return best;
}

/**
 * The cost to show and to count against the cap: the gateway's figure, or
 * the list-price estimate when the gateway has none, or reports 0 for a call
 * that used tokens.
 */
export function callCost(
  model: string,
  providerMetadata: unknown,
  tokens: { input: number; output: number; cached: number },
) {
  const reported = gatewayCost(providerMetadata);
  if (reported !== null && (reported > 0 || tokens.input + tokens.output === 0))
    return reported;
  return estimateCost(model, tokens.input, tokens.output, tokens.cached);
}

/**
 * Records one model call's tokens and price, and returns the `cost` event to
 * emit. The gateway reports what it charged; without that, the cost is
 * estimated from the list price, cache reads included.
 */
export async function trackCall(input: {
  runId: string;
  purpose: Purpose;
  model: string;
  usage: Partial<LanguageModelUsage> | undefined;
  providerMetadata: unknown;
  started: number;
}): Promise<CallCost> {
  const inputTokens = input.usage?.inputTokens ?? 0;
  const outputTokens = input.usage?.outputTokens ?? 0;
  const cachedInputTokens =
    input.usage?.inputTokenDetails?.cacheReadTokens ?? 0;
  const costUsd = callCost(input.model, input.providerMetadata, {
    input: inputTokens,
    output: outputTokens,
    cached: cachedInputTokens,
  });
  const ms = Date.now() - input.started;
  await recordCall({
    runId: input.runId,
    purpose: input.purpose,
    model: input.model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd,
    latencyMs: ms,
  });
  return {
    type: "cost",
    purpose: input.purpose,
    model: input.model,
    costUsd,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    ms,
  };
}
