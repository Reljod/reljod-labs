import type { LanguageModelUsage } from "ai";
import { asNumber, type ReadUsage } from "../metrics";

/**
 * The gateway reports the price of a call in `providerMetadata.gateway`, as a
 * number or a decimal string, and the provider it routed to under `routing`.
 */
export function readUsage(input: {
  requested: string;
  modelId: string | undefined;
  usage: LanguageModelUsage;
  gateway: unknown;
}): ReadUsage {
  const gateway = isRecord(input.gateway) ? input.gateway : {};
  const routing = isRecord(gateway.routing) ? gateway.routing : {};
  const provider = [
    routing.finalProvider,
    routing.resolvedProvider,
    gateway.provider,
  ].find((value): value is string => typeof value === "string");
  return {
    model: input.modelId || input.requested,
    provider: provider ?? null,
    inputTokens: input.usage.inputTokens ?? null,
    outputTokens: input.usage.outputTokens ?? null,
    reasoningTokens: input.usage.outputTokenDetails?.reasoningTokens ?? null,
    cachedInputTokens: input.usage.inputTokenDetails?.cacheReadTokens ?? null,
    costUsd: asNumber(gateway.cost) ?? asNumber(gateway.marketCost),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
