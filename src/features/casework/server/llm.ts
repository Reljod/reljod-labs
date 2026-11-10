import "server-only";
import { createGateway, type LanguageModelUsage } from "ai";
import {
  estimateCost,
  type ModelSettings,
  type Purpose,
} from "../domain/model-config";
import { env } from "./env";
import { recordModelCall } from "./repository";

let gatewayClient: ReturnType<typeof createGateway> | undefined;

export function gateway() {
  gatewayClient ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return gatewayClient;
}

/** The AI SDK call options a purpose's settings translate to. */
export function callOptions(settings: ModelSettings) {
  return {
    model: gateway()(settings.model),
    ...(settings.reasoning ? { reasoning: settings.reasoning } : {}),
    ...(settings.temperature !== null
      ? { temperature: settings.temperature }
      : {}),
    ...(settings.maxOutputTokens !== null
      ? { maxOutputTokens: settings.maxOutputTokens }
      : {}),
  };
}

export type CallCost = {
  purpose: Purpose;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
};

/**
 * Records one model call's tokens and price. The gateway reports what it
 * charged in provider metadata; without it, the cost is estimated from the
 * model's list price.
 */
export async function trackCall(input: {
  purpose: Purpose;
  model: string;
  usage: LanguageModelUsage | undefined;
  providerMetadata: unknown;
  started: number;
  sessionId: string | null;
  runId: string | null;
}): Promise<CallCost> {
  const usage = input.usage;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const metadata = input.providerMetadata as
    | { gateway?: { cost?: string } }
    | undefined;
  const reported = Number(metadata?.gateway?.cost);
  const costUsd =
    Number.isFinite(reported) && metadata?.gateway?.cost
      ? reported
      : estimateCost(input.model, inputTokens, outputTokens);
  const ms = Date.now() - input.started;
  await recordModelCall({
    sessionId: input.sessionId,
    runId: input.runId,
    purpose: input.purpose,
    model: input.model,
    inputTokens,
    outputTokens,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? 0,
    cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    costUsd,
    latencyMs: ms,
  }).catch(() => {
    // Spend tracking never fails the work it measures.
  });
  return {
    purpose: input.purpose,
    model: input.model,
    costUsd,
    inputTokens,
    outputTokens,
    ms,
  };
}
