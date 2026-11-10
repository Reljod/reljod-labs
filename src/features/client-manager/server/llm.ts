import "server-only";
import { createGateway, type LanguageModelUsage } from "ai";
import type { Usage } from "../domain/events";
import { env } from "./env";
import { recordModelCall } from "./repository";

let gatewayClient: ReturnType<typeof createGateway> | undefined;

export function gateway() {
  gatewayClient ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return gatewayClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The price the gateway charged, from `providerMetadata.gateway.cost`. */
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

export type CallContext = {
  clientId: string | null;
  buildId: string | null;
  visitorHash: string;
};

/**
 * Records one model call's tokens and the cost the gateway reported. Spend
 * tracking never fails the work it measures.
 */
export async function track(
  context: CallContext,
  input: {
    purpose: Usage["purpose"];
    model: string;
    usage: Partial<LanguageModelUsage> | undefined;
    costUsd: number | null;
    started: number;
  },
): Promise<Usage> {
  const usage: Usage = {
    purpose: input.purpose,
    model: input.model,
    inputTokens: input.usage?.inputTokens ?? 0,
    outputTokens: input.usage?.outputTokens ?? 0,
    costUsd: input.costUsd,
    ms: Date.now() - input.started,
  };
  await recordModelCall(context, usage).catch(() => {});
  return usage;
}
