import "server-only";
import { createGateway, type LanguageModelUsage } from "ai";
import { estimateCost, type TrailEventInput } from "../domain/contract";
import { env } from "./env";
import { recordModelCall } from "./repository";

let gatewayClient: ReturnType<typeof createGateway> | undefined;

export function gateway() {
  gatewayClient ??= createGateway({ apiKey: env.aiGatewayApiKey() });
  return gatewayClient;
}

/** The AI SDK options for one Examiner call: a little reasoning, and gateway caching. */
export function callOptions(model: string) {
  return {
    model: gateway()(model),
    reasoning: "low" as const,
    providerOptions: { gateway: { caching: "auto" as const } },
  };
}

export type CallCost = Extract<TrailEventInput, { type: "cost" }>;

/**
 * What a call is worth according to the gateway: the larger of what it
 * charged (`cost`) and the list price (`marketCost`), or null when it reports
 * neither. A call paid by credits reports `cost` 0; the demo shows and caps
 * spend at what the call is worth.
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

/** The cost to show and to count against the cap: the gateway's figure, else the list-price estimate. */
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

/** Records one model call's tokens and price, and returns the `cost` event to emit. */
export async function trackCall(input: {
  examinationId: string;
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
  await recordModelCall({
    examinationId: input.examinationId,
    model: input.model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd,
    latencyMs: ms,
  }).catch((error) => console.error("[loupe] model call record failed", error));
  return {
    type: "cost",
    model: input.model,
    costUsd,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    ms,
  };
}
